import AppKit
import QuartzCore

enum JeanAnim: Equatable { case idle, walk, talk, sleep, dangle, love, stunt(Stunt) }

/// The pixel Jean-Claude on screen: draws the current sprite frame plus
/// small overlay effects, and handles click / drag / right-click.
final class JeanView: NSView {

    var onPoke: (() -> Void)?
    var onRightClick: ((NSEvent) -> Void)?
    var onDragChanged: ((Bool) -> Void)?
    var onDragEnded: (() -> Void)?

    var anim: JeanAnim = .idle { didSet { if anim != oldValue { animStart = CACurrentMediaTime() } } }
    var facingRight = true

    private var mouseDownScreenPoint: NSPoint?
    private var windowOriginAtMouseDown: NSPoint?
    private var didDrag = false
    private let t0 = CACurrentMediaTime()
    private var animStart = CACurrentMediaTime()

    override var isFlipped: Bool { true }

    private static let heart = [".X.X.", "XXXXX", ".XXX.", "..X.."]
    private static let zGlyph = ["XXX", ".X.", "XXX"]
    private static let spark = [".X.", "XXX", ".X."]
    private static let note = [".XX", ".X.", "XX.", "XX."]
    private static let coconut = ["XX", "XX"]
    private static let dash = ["XXX"]

    private var spriteFrame: JeanSprite.Frame {
        let t = CACurrentMediaTime() - animStart
        switch anim {
        case .idle, .love: return .idle
        case .walk: return Int((CACurrentMediaTime() - t0) * 6) % 2 == 0 ? .walkA : .walkB
        case .talk: return Int(t * 5) % 2 == 0 ? .talk : .idle
        case .sleep: return .sleep
        case .dangle: return .walkA
        case .stunt(let s): return s.frames[Int(t * s.fps) % s.frames.count]
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let s = bounds.width / CGFloat(JeanSprite.W)
        let g = JeanSprite.frame(spriteFrame)
        let t = CACurrentMediaTime() - animStart

        func cell(_ c: Int, _ r: Int, _ color: NSColor) {
            let x = facingRight ? c : (JeanSprite.W - 1 - c)
            color.setFill()
            CGRect(x: CGFloat(x) * s, y: CGFloat(r) * s, width: ceil(s), height: ceil(s)).fill()
        }
        func glyph(_ rows: [String], _ x: Int, _ y: Int, _ color: NSColor) {
            for (r, row) in rows.enumerated() { for (c, ch) in row.enumerated() where ch == "X" { cell(x + c, y + r, color) } }
        }

        for r in 0..<JeanSprite.H { for c in 0..<JeanSprite.W {
            guard let ch = g[r][c], let color = JeanSprite.palette[ch] else { continue }
            cell(c, r, color)
        } }

        let gold = JeanSprite.hex(0xFFE28A), sweat = JeanSprite.hex(0xA5D4EC), line = JeanSprite.hex(0x7D7269)
        switch anim {
        case .sleep:
            let zp = Int(t * 1.5) % 3
            glyph(Self.zGlyph, 25, 4 - zp, JeanSprite.hex(0x8FA9BD))
            glyph(Self.zGlyph, 28, 2 - ((zp + 1) % 3), JeanSprite.hex(0x5F7688))
        case .love:
            let hp = Int(t * 3) % 4
            if hp < 3 { glyph(Self.heart, 25, 3 - hp, JeanSprite.hex(0xFF5D73)) }
            let hp2 = (hp + 2) % 4
            if hp2 < 3 { glyph(Self.heart, 2, 4 - hp2, JeanSprite.hex(0xFF8FA0)) }
        case .stunt(.splits):
            if Int(t * 4) % 2 == 0 { glyph(Self.spark, 3, 12, gold) } else { glyph(Self.spark, 26, 10, gold) }
            if Int(t * 2) % 2 == 0 { cell(24, 8, sweat); cell(24, 9, sweat) }
        case .stunt(.epicSplit):
            // motion lines behind both trucks, drifting outward
            let ph = Int(t * 8) % 3
            for i in 0..<2 { glyph(Self.dash, 9 + ph + i * 1, 25 + i, line); glyph(Self.dash, 20 - ph - i, 25 + i, line) }
            if Int(t * 2) % 2 == 0 { cell(24, 5, sweat); cell(24, 6, sweat) }
        case .stunt(.kumite), .stunt(.treeKick):
            if Int(t * 8) % 2 == 0 { glyph(Self.spark, 29, 22, gold) }
            if case .stunt(.treeKick) = anim, Int(t * 4) % 3 != 0 {
                let fall = Int(t * 10) % 12
                glyph(Self.coconut, 26, 4 + fall, JeanSprite.hex(0x8A5A2E))
            }
        case .stunt(.dance):
            let np = Int(t * 3) % 3
            glyph(Self.note, 1, 6 - np, JeanSprite.hex(0xFF8FA0))
            glyph(Self.note, 27, 3 + np, gold)
        case .stunt(.flashKick):
            let ph = Int(t * 6) % 3
            glyph(Self.spark, 4 + ph * 2, 24 - ph * 3, gold)
            glyph(Self.spark, 26 - ph, 26 - ph * 4, JeanSprite.hex(0x6FA8DC))
        case .stunt(.mullet):
            let ph = Int(t * 5) % 2
            for i in 0..<3 { glyph(Self.dash, 28 - ph, 2 + i * 3, line) }
        case .stunt(.guardUp):
            if Int(t * 4) % 4 == 0 { cell(6, 12, gold); cell(7, 11, gold) }
        default:
            break
        }
    }

    // MARK: - Mouse (click = poke, drag = move, right-click = menu)

    override func mouseDown(with event: NSEvent) {
        mouseDownScreenPoint = NSEvent.mouseLocation
        windowOriginAtMouseDown = window?.frame.origin
        didDrag = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = mouseDownScreenPoint, let origin = windowOriginAtMouseDown, let window else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - start.x, dy = now.y - start.y
        if !didDrag && abs(dx) + abs(dy) > 4 { didDrag = true; onDragChanged?(true) }
        if didDrag { window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy)) }
    }

    override func mouseUp(with event: NSEvent) {
        if didDrag { onDragChanged?(false); onDragEnded?() } else { onPoke?() }
        mouseDownScreenPoint = nil; windowOriginAtMouseDown = nil; didDrag = false
    }

    override func rightMouseDown(with event: NSEvent) { onRightClick?(event) }
}
