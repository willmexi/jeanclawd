import Foundation

struct JeanTask: Identifiable, Equatable {
    let id: String
    let title: String
    let status: String
    let priority: Int
    let project: String?
    let date: String
    var done: Bool { status == "done" }
}

struct JeanSummary {
    var date = ""
    var done = 0, total = 0, overdue = 0
    var weekPct = -1, streak = -1
    var tasks: [JeanTask] = []
    var overdueTasks: [JeanTask] = []
    var text: String {
        var s = "\(done)/\(total) done today"
        if overdue > 0 { s += ", \(overdue) overdue" }
        if weekPct >= 0 { s += " · week \(weekPct)%" }
        if streak > 0 { s += " · \(streak)🔥" }
        return s
    }
}

struct PetMessage { let text: String; let seconds: Double; let anim: String }

/// Talks to the Jean Clawd server when it runs, and reads ~/.jean/jean.json directly when it does not.
final class JeanClient {
    static let shared = JeanClient()

    let dataFile: URL = {
        if let p = ProcessInfo.processInfo.environment["JEAN_DATA"] { return URL(fileURLWithPath: p) }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".jean/jean.json")
    }()

    private func rawState() -> [String: Any]? {
        guard let data = try? Data(contentsOf: dataFile) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    var port: Int { (rawState()?["settings"] as? [String: Any])?["port"] as? Int ?? 4242 }
    var ownerName: String { (rawState()?["settings"] as? [String: Any])?["ownerName"] as? String ?? "" }
    var quipsEnabled: Bool { (rawState()?["settings"] as? [String: Any])?["petQuips"] as? Bool ?? true }
    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    static var today: String { dayFormatter.string(from: Date()) }

    private func task(from d: [String: Any], projects: [String: String]) -> JeanTask {
        JeanTask(id: d["id"] as? String ?? "", title: d["title"] as? String ?? "", status: d["status"] as? String ?? "todo",
                 priority: d["priority"] as? Int ?? 2,
                 project: (d["projectName"] as? String) ?? (d["project"] as? String).flatMap { projects[$0] },
                 date: d["date"] as? String ?? "")
    }

    /// Offline summary computed straight from the JSON file (no week %/streak).
    func summaryFromFile() -> JeanSummary? {
        guard let state = rawState() else { return nil }
        let projects = Dictionary(uniqueKeysWithValues: ((state["projects"] as? [[String: Any]]) ?? []).compactMap { c -> (String, String)? in
            guard let id = c["id"] as? String, let name = c["name"] as? String else { return nil }
            return (id, "\((c["emoji"] as? String) ?? "") \(name)".trimmingCharacters(in: .whitespaces))
        })
        let today = Self.today
        let all = ((state["tasks"] as? [[String: Any]]) ?? []).map { task(from: $0, projects: projects) }
        let dayTasks = all.filter { $0.date == today && (($0.id).hasPrefix("t")) }
        let overdue = all.filter { $0.date < today && !$0.done }
        var s = JeanSummary()
        s.date = today
        s.tasks = dayTasks.sorted { ($0.done ? 1 : 0, $0.priority) < ($1.done ? 1 : 0, $1.priority) }
        s.overdueTasks = overdue
        s.total = dayTasks.count
        s.done = dayTasks.filter { $0.done }.count
        s.overdue = overdue.count
        return s
    }

    private func summary(fromAPI d: [String: Any]) -> JeanSummary {
        var s = JeanSummary()
        s.date = d["date"] as? String ?? ""
        s.tasks = ((d["tasks"] as? [[String: Any]]) ?? []).map { task(from: $0, projects: [:]) }
        s.overdueTasks = ((d["overdue"] as? [[String: Any]]) ?? []).map { task(from: $0, projects: [:]) }
        if let st = d["stats"] as? [String: Any] {
            if let t = st["today"] as? [String: Any] { s.done = t["done"] as? Int ?? 0; s.total = t["total"] as? Int ?? 0; s.overdue = t["overdue"] as? Int ?? 0 }
            if let w = st["week"] as? [String: Any] { s.weekPct = w["pct"] as? Int ?? -1 }
            s.streak = st["streak"] as? Int ?? -1
        }
        return s
    }

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil, timeout: TimeInterval = 2,
                         completion: @escaping ([String: Any]?) -> Void) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: timeout)
        req.httpMethod = method
        if let body {
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            DispatchQueue.main.async { completion(ok ? (json ?? [:]) : nil) }
        }.resume()
    }

    func health(completion: @escaping (Bool) -> Void) { request("GET", "api/health", timeout: 1) { completion($0 != nil) } }

    /// Drain queued messages for Jean-Claude; also returns the live summary. Nil summary = server down.
    func poll(completion: @escaping ([PetMessage], JeanSummary?) -> Void) {
        request("GET", "api/jc/messages") { [weak self] json in
            guard let self, let json else { return completion([], nil) }
            let msgs = ((json["messages"] as? [[String: Any]]) ?? []).map {
                PetMessage(text: $0["text"] as? String ?? "", seconds: $0["seconds"] as? Double ?? 8, anim: $0["anim"] as? String ?? "talk")
            }
            let sum = (json["summary"] as? [String: Any]).map { self.summary(fromAPI: $0) }
            completion(msgs, sum)
        }
    }
    // No write methods: the plan is changed by AI agents (jean CLI / MCP / API), never from the pet.
}
