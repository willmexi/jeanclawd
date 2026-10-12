import AppKit
import SwiftUI

enum BubbleContent {
    case quip(String)
    case plan(title: String, lines: [String])
    case caption(title: String, movie: String)
}

struct BubbleView: View {
    let content: BubbleContent
    var onClose: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            inner
                .background(DS.surface)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(DS.orange, lineWidth: 2))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            tail.padding(.top, -1)
        }
        .onTapGesture { onClose() }
    }

    @ViewBuilder private var inner: some View {
        switch content {
        case .quip(let text):
            Text(text).font(DS.mono(12)).foregroundColor(DS.text)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: 320, alignment: .leading).fixedSize(horizontal: true, vertical: true)
        case .caption(let title, let movie):
            HStack(spacing: 6) {
                Text("🎬").font(.system(size: 10))
                Text(title).font(DS.mono(10, .bold)).foregroundColor(DS.text)
                Text(movie).font(DS.mono(10)).foregroundColor(DS.dim)
            }
            .padding(.horizontal, 10).padding(.vertical, 5).fixedSize()
        case .plan(let title, let lines):
            VStack(alignment: .leading, spacing: 3) {
                Text(title.uppercased()).font(DS.mono(9, .bold)).foregroundColor(DS.orange).padding(.bottom, 2)
                ForEach(Array(lines.enumerated()), id: \.offset) { _, l in
                    Text(l).font(DS.mono(11)).foregroundColor(l.hasPrefix("✓") ? DS.dim : DS.text).lineLimit(1)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(width: 300, alignment: .leading)
        }
    }

    private var tail: some View {
        VStack(spacing: 0) {
            ZStack { Rectangle().fill(DS.orange).frame(width: 18, height: 5); Rectangle().fill(DS.surface).frame(width: 14, height: 5) }
            ZStack { Rectangle().fill(DS.orange).frame(width: 12, height: 5); Rectangle().fill(DS.surface).frame(width: 8, height: 3).offset(y: -1) }
            Rectangle().fill(DS.orange).frame(width: 6, height: 4)
        }
    }
}

/// Floating, non-activating panel that sits above Jean-Claude and follows him.
final class SpeechBubble {
    private var panel: NSPanel?
    private var dismissWork: DispatchWorkItem?
    var isVisible: Bool { panel != nil }

    func show(_ content: BubbleContent, above frame: NSRect, seconds: TimeInterval, onDismiss: @escaping () -> Void) {
        dismiss()
        let host = NSHostingView(rootView: BubbleView(content: content, onClose: { [weak self] in self?.dismiss(); onDismiss() }))
        host.layoutSubtreeIfNeeded()
        let size = host.fittingSize
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = true
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        p.isReleasedWhenClosed = false
        p.contentView = host
        panel = p
        follow(above: frame)
        p.orderFrontRegardless()
        let work = DispatchWorkItem { [weak self] in self?.dismiss(); onDismiss() }
        dismissWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    func follow(above frame: NSRect) {
        guard let panel else { return }
        let screen = NSScreen.screens.first { $0.frame.intersects(frame) }?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        var x = frame.midX - panel.frame.width / 2
        x = max(screen.minX + 4, min(x, screen.maxX - panel.frame.width - 4))
        var y = frame.maxY + 2
        if y + panel.frame.height > screen.maxY { y = frame.minY - panel.frame.height - 2 }
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    func dismiss() {
        dismissWork?.cancel(); dismissWork = nil
        panel?.orderOut(nil); panel = nil
    }
}

enum DS {
    static let surface = Color(red: 0.114, green: 0.098, blue: 0.082)   // #1d1915
    static let panel = Color(red: 0.137, green: 0.118, blue: 0.098)
    static let text = Color(red: 0.957, green: 0.929, blue: 0.894)     // #f4ede4
    static let dim = Color(red: 0.725, green: 0.678, blue: 0.627)
    static let faint = Color(red: 0.49, green: 0.447, blue: 0.412)
    static let orange = Color(red: 0.851, green: 0.467, blue: 0.341)   // #d97757
    static let green = Color(red: 0.498, green: 0.718, blue: 0.494)
    static let red = Color(red: 0.878, green: 0.478, blue: 0.373)
    static let line = Color(red: 0.227, green: 0.196, blue: 0.165)
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }
}
