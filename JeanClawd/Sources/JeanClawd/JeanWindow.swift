import AppKit

/// Borderless, transparent, always-on-top window exactly the size of the sprite.
final class JeanWindow: NSWindow {

    let jean = JeanView()
    static let bottomInset: CGFloat = 2

    static func size(scale: CGFloat) -> NSSize {
        NSSize(width: CGFloat(JeanSprite.W) * scale, height: CGFloat(JeanSprite.H) * scale)
    }

    init(scale: CGFloat) {
        let size = Self.size(scale: scale)
        let screen = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let rect = NSRect(x: screen.midX - size.width / 2, y: screen.minY + Self.bottomInset, width: size.width, height: size.height)
        super.init(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .statusBar // above the Dock
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isReleasedWhenClosed = false
        contentView = jean
    }

    func apply(scale: CGFloat) { setContentSize(Self.size(scale: scale)) }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
