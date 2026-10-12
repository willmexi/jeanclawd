import SwiftUI

struct PanelActions {
    var openWeb: () -> Void
    var stunt: () -> Void
    var sayPlan: () -> Void
    var openSettings: () -> Void
    var quit: () -> Void
    var closePanel: () -> Void
}

final class PanelModel: ObservableObject {
    @Published var summary = JeanSummary()
    @Published var offline = false
    func refresh() {
        JeanClient.shared.poll { [weak self] _, sum in
            guard let self else { return }
            if let sum { self.summary = sum; self.offline = false }
            else { self.summary = JeanClient.shared.summaryFromFile() ?? JeanSummary(); self.offline = true }
        }
    }
}

/// The menu-bar popover: today's plan (read-only: the plan is changed by AI agents, never by hand), plus the app actions.
struct PanelView: View {
    let actions: PanelActions
    @StateObject private var model = PanelModel()
    @ObservedObject private var server = ServerManager.shared
    @ObservedObject private var settings = AppSettings.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(nsImage: JeanSprite.image(.idle, scale: 1.5)).frame(width: 30, height: 42).clipped()
                VStack(alignment: .leading, spacing: 1) {
                    Text("JEAN CLAWD").font(DS.mono(12, .heavy)).foregroundColor(DS.orange).kerning(2)
                    Text(model.summary.text).font(DS.mono(10)).foregroundColor(DS.dim)
                }
                Spacer()
                Circle().fill(server.running ? DS.green : DS.faint).frame(width: 7, height: 7)
                    .help(server.running ? "server running" : "server stopped")
            }
            .padding(.horizontal, 14).padding(.vertical, 10)

            if model.summary.total > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(DS.line)
                        Rectangle().fill(DS.orange).frame(width: geo.size.width * CGFloat(model.summary.done) / CGFloat(max(1, model.summary.total)))
                    }
                }.frame(height: 4)
            } else { Rectangle().fill(DS.line).frame(height: 1) }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if model.summary.tasks.isEmpty {
                        Text(model.offline ? "server off — showing the file" : "nothing planned today").font(DS.mono(11)).foregroundColor(DS.faint).padding(14)
                        if model.summary.tasks.isEmpty { Text("ask Claude to plan your day").font(DS.mono(10)).foregroundColor(DS.faint).padding(.horizontal, 14) }
                    }
                    ForEach(model.summary.tasks) { t in row(t) }
                    if !model.summary.overdueTasks.isEmpty {
                        Text("OVERDUE").font(DS.mono(9, .bold)).foregroundColor(DS.red).padding(.horizontal, 14).padding(.top, 8)
                        ForEach(model.summary.overdueTasks) { t in row(t) }
                    }
                }.padding(.vertical, 6)
            }
            .frame(maxHeight: 320)

            Rectangle().fill(DS.line).frame(height: 1)
            HStack(spacing: 6) {
                button("Open Jean Clawd", primary: true) { actions.openWeb(); actions.closePanel() }
                button("Plan 💬") { actions.sayPlan(); actions.closePanel() }
                button("Stunt 🎬") { actions.stunt(); actions.closePanel() }
            }.padding(.horizontal, 12).padding(.vertical, 10)
            HStack(spacing: 6) {
                button(settings.hidden ? "Show" + (settings.hotkeyEnabled ? " (\(settings.hotkeyDisplay))" : "") : "Hide" + (settings.hotkeyEnabled ? " (\(settings.hotkeyDisplay))" : "")) { settings.hidden.toggle() }
                button((settings.paused ? "Walk" : "Pause") + (settings.pauseHotkeyEnabled ? " (\(settings.pauseHotkeyDisplay))" : "")) { settings.paused.toggle() }
                button(server.running ? "Stop server" : "Start server") { server.running ? server.stop() : server.start() }
                button("Settings…") { actions.openSettings(); actions.closePanel() }
                Spacer()
                button("Quit") { actions.quit() }
            }.padding(.horizontal, 12).padding(.bottom, 10)
        }
        .frame(width: 340)
        .background(DS.panel)
        .onAppear { model.refresh(); server.refresh() }
    }

    private func row(_ t: JeanTask) -> some View {
        HStack(alignment: .top, spacing: 8) {
            ZStack {   // status only — Claude ticks tasks off, not the panel
                RoundedRectangle(cornerRadius: 4).stroke(t.done ? DS.green : DS.faint, lineWidth: 1.5).frame(width: 14, height: 14)
                if t.done { RoundedRectangle(cornerRadius: 4).fill(DS.green).frame(width: 14, height: 14); Text("✓").font(.system(size: 9, weight: .bold)).foregroundColor(.white) }
            }.padding(.top, 2)
            VStack(alignment: .leading, spacing: 1) {
                Text(t.title).font(.system(size: 12)).foregroundColor(t.done ? DS.faint : DS.text).strikethrough(t.done)
                HStack(spacing: 6) {
                    if t.priority == 1 { Text("!! urgent").font(DS.mono(9, .bold)).foregroundColor(DS.red) }
                    if let c = t.project { Text(c).font(DS.mono(9)).foregroundColor(DS.dim) }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 5)
    }

    private func button(_ title: String, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 11, weight: .semibold))
                .foregroundColor(primary ? .white : DS.text)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(primary ? DS.orange : DS.surface)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(primary ? DS.orange : DS.line, lineWidth: 1))
                .cornerRadius(6)
        }.buttonStyle(.plain)
    }
}
