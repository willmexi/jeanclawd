import AppKit
import Combine

/// Starts `node server/server.js` for the web app and keeps it alive.
final class ServerManager: ObservableObject {
    static let shared = ServerManager()

    @Published private(set) var running = false
    @Published private(set) var lastError: String?
    private var process: Process?
    private var stoppedByUs = false
    private var restarts = 0
    private let settings = AppSettings.shared

    var url: URL { JeanClient.shared.baseURL }

    /// Where the JS lives: user setting → path baked in at package time → copy inside the bundle.
    var projectDir: URL? {
        let fm = FileManager.default
        let candidates: [String?] = [
            settings.projectPath.isEmpty ? nil : settings.projectPath,
            Bundle.main.object(forInfoDictionaryKey: "JeanProjectPath") as? String,
            Bundle.main.resourceURL?.appendingPathComponent("jean").path,
            // running via `swift run` from the repo
            URL(fileURLWithPath: fm.currentDirectoryPath).path,
        ]
        for c in candidates.compactMap({ $0 }) where fm.fileExists(atPath: c + "/server/server.js") {
            return URL(fileURLWithPath: c)
        }
        return nil
    }

    /// GUI apps do not get the shell PATH, so ask a login shell where node is.
    func resolveNode() -> String? {
        let fm = FileManager.default
        if !settings.nodePath.isEmpty, fm.isExecutableFile(atPath: settings.nodePath) { return settings.nodePath }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v node"]
        let pipe = Pipe(); p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
        if (try? p.run()) != nil {
            p.waitUntilExit()
            let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !out.isEmpty, fm.isExecutableFile(atPath: out) { return out }
        }
        for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] where fm.isExecutableFile(atPath: c) { return c }
        // nvm without a login shell: newest installed version
        let nvm = fm.homeDirectoryForCurrentUser.appendingPathComponent(".nvm/versions/node")
        if let versions = try? fm.contentsOfDirectory(atPath: nvm.path).sorted().reversed() {
            for v in versions { let c = nvm.appendingPathComponent("\(v)/bin/node").path; if fm.isExecutableFile(atPath: c) { return c } }
        }
        return nil
    }

    func start() {
        JeanClient.shared.health { [weak self] up in
            guard let self else { return }
            if up { self.running = true; return } // already served (e.g. `jean serve` in a terminal)
            self.spawn()
        }
    }

    private func spawn() {
        guard process == nil else { return }
        guard let node = resolveNode() else { lastError = "node not found — set the path in Settings"; return }
        guard let dir = projectDir else { lastError = "Jean Clawd folder not found — set it in Settings"; return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: node)
        p.arguments = [dir.appendingPathComponent("server/server.js").path]
        p.currentDirectoryURL = dir
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self else { return }
                self.process = nil
                self.running = false
                if !self.stoppedByUs && proc.terminationStatus != 2 && self.restarts < 5 { // 2 = port busy
                    self.restarts += 1
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.spawn() }
                } else if proc.terminationStatus == 2 {
                    self.running = true // someone else owns the port; that is fine
                }
            }
        }
        stoppedByUs = false
        do { try p.run(); process = p; lastError = nil }
        catch { lastError = error.localizedDescription; return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            JeanClient.shared.health { up in self?.running = up }
        }
    }

    func stop() {
        stoppedByUs = true
        process?.terminate()
        process = nil
        running = false
    }

    func refresh() { JeanClient.shared.health { [weak self] up in self?.running = up } }

    func openWeb() {
        if running { NSWorkspace.shared.open(url); return }
        start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { NSWorkspace.shared.open(self.url) }
    }
}
