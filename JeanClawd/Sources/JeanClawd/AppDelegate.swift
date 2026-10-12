import AppKit
import Carbon.HIToolbox
import Combine
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {

    private var jeanWindow: JeanWindow!
    private var statusItem: NSStatusItem!
    private var walkTimer: Timer?
    private var hotKey: HotKey?
    private var pauseHotKey: HotKey?
    private var pollTimer: Timer?
    private let bubble = SpeechBubble()
    private var popover: NSPopover?
    private var settingsWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()

    private let settings = AppSettings.shared
    private let client = JeanClient.shared
    private let server = ServerManager.shared

    // Walk state
    private var direction: CGFloat = 1
    private var speaking = false
    private var speakAnim: JeanAnim = .talk
    private var dragging = false
    private var idleUntil: Date?
    private var stuntUntil: Date?
    private var stuntAnim: JeanAnim = .stunt(.splits)
    private var lastStunt: Stunt?
    private var tick = 0
    private var syncingWalkHeight = false
    private var quipIndex = Int.random(in: 0..<100)
    private var lastSummary: JeanSummary?

    func applicationDidFinishLaunching(_ notification: Notification) {
        jeanWindow = JeanWindow(scale: settings.scale)
        jeanWindow.jean.onPoke = { [weak self] in self?.poke() }
        jeanWindow.jean.onRightClick = { [weak self] e in self?.showContextMenu(e) }
        jeanWindow.jean.onDragChanged = { [weak self] d in self?.dragging = d }
        jeanWindow.jean.onDragEnded = { [weak self] in self?.dragEnded() }
        applyWalkHeight()
        jeanWindow.orderFrontRegardless()

        setupStatusItem()
        observeSettings()
        registerHotkey()
        applyHidden()
        if settings.autoStartServer { server.start() }
        if settings.openOnLaunch { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.server.openWeb() } }

        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.step() }
        RunLoop.main.add(timer, forMode: .common)
        walkTimer = timer

        let poll = Timer(timeInterval: 4, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(poll, forMode: .common)
        pollTimer = poll

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.greet() }
    }

    func applicationWillTerminate(_ notification: Notification) { server.stop() }

    // MARK: - Settings plumbing

    private func observeSettings() {
        settings.$scale.removeDuplicates().sink { [weak self] s in self?.jeanWindow.apply(scale: s); self?.applyWalkHeight() }.store(in: &cancellables)
        settings.$hidden.removeDuplicates().dropFirst().sink { [weak self] _ in self?.applyHidden() }.store(in: &cancellables)
        settings.$hotkeyEnabled.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$hotkeyKeyCode.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$hotkeyFlags.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$pauseHotkeyEnabled.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$pauseHotkeyKeyCode.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$pauseHotkeyFlags.removeDuplicates().dropFirst().sink { [weak self] _ in self?.registerHotkey() }.store(in: &cancellables)
        settings.$walkHeight.removeDuplicates().sink { [weak self] _ in
            guard let self, !self.syncingWalkHeight else { return }
            self.applyWalkHeight()
        }.store(in: &cancellables)
    }

    // MARK: - Hide / show (global shortcut, default ⌘J)

    /// (Re)register the global shortcut from settings. Called on launch and after a rebind.
    func registerHotkey() {
        hotKey = nil; pauseHotKey = nil
        if settings.hotkeyEnabled {
            hotKey = HotKey(id: 1, keyCode: UInt32(settings.hotkeyKeyCode), modifiers: settings.hotkeyCarbonModifiers) { [weak self] in self?.toggleHidden() }
        }
        if settings.pauseHotkeyEnabled {
            pauseHotKey = HotKey(id: 2, keyCode: UInt32(settings.pauseHotkeyKeyCode), modifiers: settings.pauseHotkeyCarbonModifiers) { [weak self] in self?.togglePauseHotkey() }
        }
    }

    private func togglePauseHotkey() {
        settings.paused.toggle()
        if settings.hidden { return }
        say(.quip(settings.paused ? "Standing by." : "Walking."), seconds: 1.5, anim: settings.paused ? .sleep : .talk)
    }

    @objc private func toggleHidden() { settings.hidden.toggle() }

    private func applyHidden() {
        if settings.hidden {
            bubble.dismiss(); speaking = false
            popover?.performClose(nil)
            jeanWindow.orderOut(nil)
        } else {
            jeanWindow.orderFrontRegardless()
            say(.quip("I'm back, \(name)."), seconds: 2.5, anim: .love)
        }
    }

    // MARK: - Walking

    private var screenRect: NSRect { (jeanWindow.screen ?? NSScreen.main)?.frame ?? .zero }
    private var walkY: CGFloat { clampY(screenRect.minY + CGFloat(settings.walkHeight), in: screenRect) }
    private func clampY(_ y: CGFloat, in s: NSRect) -> CGFloat { max(s.minY, min(y, s.maxY - jeanWindow.frame.height)) }
    private func applyWalkHeight() { var o = jeanWindow.frame.origin; o.y = walkY; jeanWindow.setFrameOrigin(o) }

    private func dragEnded() {
        let s = screenRect
        syncingWalkHeight = true
        settings.walkHeight = Double(clampY(jeanWindow.frame.origin.y, in: s) - s.minY)
        syncingWalkHeight = false
    }

    private func currentAnim() -> JeanAnim {
        if dragging { return .dangle }
        if let until = stuntUntil, Date() < until { return stuntAnim }
        if speaking { return speakAnim }
        if settings.paused { return .sleep }
        if idleUntil != nil { return .idle }
        return .walk
    }

    private func step() {
        tick += 1
        if settings.hidden { return }
        if dragging && NSEvent.pressedMouseButtons == 0 { dragging = false; dragEnded() } // missed mouse-up
        if speaking && !bubble.isVisible { speaking = false }
        if let until = stuntUntil, Date() >= until { stuntUntil = nil }

        jeanWindow.jean.anim = currentAnim()
        jeanWindow.jean.needsDisplay = true
        if bubble.isVisible { bubble.follow(above: jeanWindow.frame) }

        if dragging || settings.paused || speaking || stuntUntil != nil { return }

        if let until = idleUntil {
            if Date() < until { return }
            idleUntil = nil
            if Bool.random() { direction *= -1 }
        }
        if Int.random(in: 0..<240) == 0 { idleUntil = Date().addingTimeInterval(Double.random(in: 1.5...5)); return }
        if settings.splits && Int.random(in: 0..<1800) == 0 { doRandomStunt(); return } // ~ once a minute

        let s = screenRect
        var o = jeanWindow.frame.origin
        o.x += settings.speed.pointsPerTick * direction
        if o.x <= s.minX { o.x = s.minX; direction = 1 }
        else if o.x + jeanWindow.frame.width >= s.maxX { o.x = s.maxX - jeanWindow.frame.width; direction = -1 }
        o.y = walkY
        jeanWindow.setFrameOrigin(o)
        jeanWindow.jean.facingRight = direction > 0
    }

    private func doStunt(_ anim: JeanAnim, seconds: TimeInterval) {
        stuntAnim = anim
        stuntUntil = Date().addingTimeInterval(seconds)
    }

    /// Play a move from one of the films, with a small "which movie" caption.
    func perform(_ stunt: Stunt, caption: Bool = true) {
        lastStunt = stunt
        doStunt(.stunt(stunt), seconds: stunt.seconds)
        if caption && settings.captions {
            bubble.dismiss(); speaking = false
            say(.caption(title: stunt.title, movie: stunt.movie), seconds: stunt.seconds, anim: .stunt(stunt))
        }
    }

    private func doRandomStunt() {
        var pool = Stunt.spontaneous
        if let last = lastStunt, pool.count > 1 { pool.removeAll { $0 == last } }
        perform(pool.randomElement()!)
    }

    // MARK: - Speaking

    private func say(_ content: BubbleContent, seconds: TimeInterval, anim: JeanAnim = .talk) {
        speaking = true
        speakAnim = anim
        bubble.show(content, above: jeanWindow.frame, seconds: seconds) { [weak self] in self?.speaking = false }
    }

    private var name: String { let n = client.ownerName; return n.isEmpty ? "champion" : n }

    private var quips: [String] {[
        "I am aware of your tasks, \(name). All of them.",
        "The Muscles from Brussels says: one task at a time.",
        "Kickboxer rule #1 — finish what you start.",
        "I did the splits between two trucks. You can finish that task.",
        "Time to kick some tasks.",
        "Double Impact: two projects, one afternoon. Let's go.",
        "Hard Target: your inbox.",
        "Bloodsport had more structure than this week. Let's fix that.",
        "Timecop says: the deadline is still today.",
        "Sudden Death — that's what happens to tasks you ignore.",
        "Universal Soldier never took a day off. You should though, sometimes.",
        "Nobody puts deadlines in the corner. Wait. Wrong movie.",
        "Lionheart. Also: heart your to-do list.",
        "Focus, \(name). Like a roundhouse kick.",
    ]}

    private func planLines(_ s: JeanSummary) -> [String] {
        var lines = s.tasks.prefix(8).map { t -> String in
            "\(t.done ? "✓" : t.status == "doing" ? "▶" : "·") \(t.title)\(t.priority == 1 ? " !!" : "")"
        }
        if s.tasks.count > 8 { lines.append("… and \(s.tasks.count - 8) more") }
        if s.overdue > 0 { lines.append("⚠ \(s.overdue) overdue") }
        if lines.isEmpty { lines = ["nothing planned yet — open Jean Clawd or ask Claude"] }
        return lines
    }

    private func greet() {
        let s = client.summaryFromFile() ?? JeanSummary()
        let hour = Calendar.current.component(.hour, from: Date())
        let hello = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir"
        say(.plan(title: "\(hello) \(name) — \(s.text)", lines: planLines(s)), seconds: 8)
    }

    @objc private func sayPlan() {
        client.poll { [weak self] _, sum in
            guard let self else { return }
            let s = sum ?? self.client.summaryFromFile() ?? JeanSummary()
            self.say(.plan(title: "today — \(s.text)", lines: self.planLines(s)), seconds: 10)
        }
    }

    private func poke() {
        if stuntUntil == nil { perform(.kumite, caption: false) }
        guard settings.quips, client.quipsEnabled else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { self.sayPlan() }
            return
        }
        let line = quips[quipIndex % quips.count]
        quipIndex += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
            // every third poke: the actual plan instead of a joke
            if (self?.quipIndex ?? 0) % 3 == 0 { self?.sayPlan() } else { self?.say(.quip(line), seconds: 4, anim: .love) }
        }
    }

    private func poll() {
        client.poll { [weak self] messages, sum in
            guard let self else { return }
            if sum != nil { self.server.refresh() }
            if let sum {
                // Celebrate when everything for the day gets done.
                if let last = self.lastSummary, sum.total > 0, sum.done == sum.total, last.done < last.total {
                    self.perform(.epicSplit, caption: false)
                    self.say(.quip("All done, \(self.name)! 🥋 Epic split of a day."), seconds: 6, anim: .stunt(.epicSplit))
                }
                self.lastSummary = sum
            }
            for m in messages {
                if self.settings.hidden { self.settings.hidden = false } // a message from Claude summons him
                let stunt = Stunt(rawValue: m.anim) ?? (m.anim == "random" ? Stunt.spontaneous.randomElement() : nil)
                if let stunt { self.perform(stunt, caption: m.text.isEmpty) }
                if !m.text.isEmpty { self.say(.quip(m.text), seconds: m.seconds, anim: stunt.map { .stunt($0) } ?? .talk) }
            }
        }
    }

    // MARK: - Menu bar

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = JeanSprite.menubarImage()
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc private func togglePanel() {
        if let popover, popover.isShown { popover.performClose(nil); return }
        let actions = PanelActions(
            openWeb: { [weak self] in self?.server.openWeb() },
            stunt: { [weak self] in self?.doRandomStunt() },
            sayPlan: { [weak self] in self?.sayPlan() },
            openSettings: { [weak self] in self?.openSettings() },
            quit: { NSApp.terminate(nil) },
            closePanel: { [weak self] in self?.popover?.performClose(nil) }
        )
        let popover = NSPopover()
        popover.behavior = .transient
        let host = NSHostingController(rootView: PanelView(actions: actions))
        host.view.layoutSubtreeIfNeeded()
        popover.contentViewController = host
        popover.contentSize = host.view.fittingSize
        self.popover = popover
        if let button = statusItem.button { popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY) }
    }

    private func openSettings() {
        popover?.performClose(nil)
        if settingsWindow == nil {
            let window = NSWindow(contentViewController: NSHostingController(rootView: SettingsView()))
            window.title = "Jean Clawd Settings"
            window.styleMask = [.titled, .closable]
            window.titlebarAppearsTransparent = true
            window.backgroundColor = NSColor(srgbRed: 0.137, green: 0.118, blue: 0.098, alpha: 1)
            window.isReleasedWhenClosed = false
            window.center()
            settingsWindow = window
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Context menu

    private func showContextMenu(_ event: NSEvent) {
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector) { let i = NSMenuItem(title: title, action: sel, keyEquivalent: ""); i.target = self; menu.addItem(i) }
        item("Open Jean Clawd", #selector(openWebAction))
        item("Today's plan", #selector(sayPlan))
        let stunts = NSMenu()
        for st in Stunt.allCases {
            let i = NSMenuItem(title: "\(st.title)  —  \(st.movie)", action: #selector(stuntAction(_:)), keyEquivalent: "")
            i.target = self; i.representedObject = st.rawValue; stunts.addItem(i)
        }
        let stuntItem = NSMenuItem(title: "Stunts", action: nil, keyEquivalent: ""); stuntItem.submenu = stunts
        menu.addItem(stuntItem)
        menu.addItem(.separator())
        item(settings.hotkeyEnabled ? "Hide Jean-Claude  (\(settings.hotkeyDisplay) brings him back)" : "Hide Jean-Claude", #selector(toggleHidden))
        item((settings.paused ? "Resume walking" : "Pause walking") + (settings.pauseHotkeyEnabled ? "  (\(settings.pauseHotkeyDisplay))" : ""), #selector(togglePause))
        item("Send back to bottom", #selector(sendBackToBottom))
        item(server.running ? "Stop web server" : "Start web server", #selector(toggleServer))
        item("Settings…", #selector(openSettingsAction))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Jean Clawd", action: #selector(NSApplication.terminate(_:)), keyEquivalent: ""))
        NSMenu.popUpContextMenu(menu, with: event, for: jeanWindow.jean)
    }

    @objc private func openWebAction() { server.openWeb() }
    @objc private func stuntAction(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let st = Stunt(rawValue: raw) { perform(st) }
    }
    @objc private func togglePause() { settings.paused.toggle() }
    @objc private func sendBackToBottom() { settings.walkHeight = Double(JeanWindow.bottomInset) }
    @objc private func toggleServer() { server.running ? server.stop() : server.start() }
    @objc private func openSettingsAction() { openSettings() }
}
