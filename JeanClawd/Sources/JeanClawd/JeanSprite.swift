import AppKit

/// Pixel Jean-Claude and his stunts. Hand-port of web/sprite.js — keep the two in sync.
/// Canvas 32×28 cells; the standing body is 16 wide and sits at x=8.
enum JeanSprite {
    static let W = 32, H = 28

    static func hex(_ v: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255,
                blue: CGFloat(v & 255) / 255, alpha: 1)
    }

    static let palette: [Character: NSColor] = [
        "K": hex(0x2A1A12),
        "H": hex(0x1C1614), "h": hex(0x3A3230), // slicked-back black hair
        "S": hex(0xEBB78E), "s": hex(0xC99268),
        "O": hex(0x1F1B1A), "o": hex(0x33302E), // black tank top
        "P": hex(0x3E5F8A),                     // blue jeans
        "C": hex(0xD97757), "c": hex(0xB35C3E), // Claude orange (the twin's tank)
        "G": hex(0xF2C14E),
        "M": hex(0x8C3A2A),
        "W": hex(0xFFFFFF),
        "L": hex(0x4F8A3E), // palm leaves
        "B": hex(0x3A3F5C), // truck cab blue
    ]

    /// Cream-on-orange palette for the app icon (Claude's tile, JCVD's shape).
    static let iconPalette: [Character: NSColor] = [
        "K": hex(0x8A3E24), "H": hex(0xF4EDE4), "h": hex(0xF4EDE4), "S": hex(0xFBD6B8), "s": hex(0xF0C29C),
        "O": hex(0xF4EDE4), "o": hex(0xEADFD0), "P": hex(0xF0B896), "G": hex(0xF4EDE4), "M": hex(0xC2643F), "W": hex(0xFFFFFF),
        "C": hex(0xF4EDE4), "c": hex(0xEADFD0),
    ]

    // MARK: - Parts

    static let body = [
        "....KKKKKKKK....",
        "...KHHhhHHHHK...",
        "..KHHHHHHhHHHK..",
        "..KHHHHHHHHHHK..",
        ".KHHKSSSSSSKHHK.",
        ".KHHKSSSSSSKHHK.",
        ".KHHKSKSSKSKHHK.",
        "..KSKSSSSSSKSK..",
        "..KSKSSsSSSKSK..",
        "...KKSSSSSSKK...",
        "....KSMMMMSK....",
        "....KsSSSSsK....",
        ".....KKsSKK.....",
        ".....KKSSKK.....",
        "..KKKKKSSKKKKK..",
        ".KSSKOSSSSOKSSK.",
        "KSSSKOOSSOOKSSSK",
        "KSSSKOOooOOKSSSK",
        "KSsSKOOOOOOKSsSK",
        ".KSKKOOooOOKKSK.",
        ".KSK.KGGGGK.KSK.",
        "..K..KPPPPK..K..",
        ".....KPPPPK.....",
        ".....KPPPPK.....",
    ]
    static var head: [String] { Array(body.prefix(14)) }
    static let torso = [ // rows 14-23, no arms
        "....KKKSSKKK....",
        "....KOOOOOOK....",
        "....KOOOOOOK....",
        "....KOOooOOK....",
        "....KOOOOOOK....",
        "....KOOooOOK....",
        "....KKGGGGKK....",
        ".....KPPPPK.....",
        ".....KPPPPK.....",
        ".....KPPPPK.....",
    ]
    static let armDownL = ["..KK", ".KSS", "KSSS", "KSSS", "KSsS", ".KSK", ".KSK", "..K."]
    static let armDownR = ["KK..", "SSK.", "SSSK", "SSSK", "SsSK", "KSK.", "KSK.", ".K.."]
    static let armOutL = ["KKKKKK", "KSSSSS", "KKKKKK"]
    static let armOutR = ["KKKKKK", "SSSSSK", "KKKKKK"]
    static let armSalute = ["KKK.", "KSSK", "KSSK", ".KSK", ".KSK", ".KSK", ".KSK", ".KSK", "KKSK"]
    static let fist = ["KKK", "KSK", "KKK"]
    static let legsTogether = [".....KPPKPPK....", ".....KPPKPPK....", ".....KPPKPPK....", "....KKKKKKKKK..."]
    static let legsApart = [".....KPPKPPK....", "....KPPK.KPPK...", "....KPPK..KPPK..", "...KKKK...KKKK.."]
    static let legsSplits = [
        "..KKKKKKKKKKKKPPPPKKKKKKKKKKKK..",
        ".KPPPPPPPPPPPPPPPPPPPPPPPPPPPPK.",
        "KKKPPPPPPPPPPPPPPPPPPPPPPPPPPKKK",
        "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    ]
    static let legsKick = [
        ".....KPPKKKKKKKKKKKKKKKK",
        ".....KPPKPPPPPPPPPPPPPKK",
        "....KPPPKKKKKKKKKKKKKKK.",
        "....KKKKK...............",
    ]
    static let tree = [
        ".LLLL.", "LLLLLL", "LLhhLL", ".LhhL.", "..hh..", "..hh..", "..hh..", "..hh..", "..hh..", "..hh..", "..hh..", "..hh..", ".hhhh.",
    ]
    static let truckL = ["KKKKKKKK", "KBBKOOOK", "KWBKOOOK", ".KK..KK."]
    static let truckR = ["KKKKKKKK", "KOOOKBBK", "KOOOKBWK", ".KK..KK."]
    static let hairLong = ["HH...", "HHH..", "HHHH.", "HHHHH", "HHHH.", "HHH..", "HH...", "H...."]
    static let hairShort = ["H....", "HH...", "HH...", "HHH..", "HH...", "HH...", "H....", "....."]

    typealias Grid = [[Character?]]
    static func blank() -> Grid { Array(repeating: Array(repeating: nil, count: W), count: H) }

    static func blit(_ g: inout Grid, _ rows: [String], _ x: Int, _ y: Int, map: [Character: Character] = [:]) {
        for (r, row) in rows.enumerated() {
            for (c, ch) in row.enumerated() where ch != "." {
                let yy = y + r, xx = x + c
                if yy >= 0, yy < H, xx >= 0, xx < W { g[yy][xx] = map[ch] ?? ch }
            }
        }
    }

    // MARK: - Frames

    enum Frame: String, CaseIterable {
        case idle, walkA, walkB, talk, sleep
        case splits, epicSplit, kick, treeKickA, treeKickB, danceA, danceB, guardA, guardB
        case double, flashKickA, flashKickB, salute, mulletA, mulletB
    }

    private static var cache: [Frame: Grid] = [:]

    static func frame(_ f: Frame) -> Grid {
        if let g = cache[f] { return g }
        var g = blank()
        func standing(_ x: Int = 8, _ y: Int = 0) { blit(&g, body, x, y); blit(&g, legsTogether, x, y + 24) }
        switch f {
        case .idle: standing()
        case .walkA: blit(&g, body, 8, 0); blit(&g, legsApart, 8, 24)
        case .walkB: blit(&g, body, 8, 1); blit(&g, Array(legsTogether.dropFirst()), 8, 25)
        case .talk: standing(); for c in 14...17 { g[10][c] = "K" }
        case .sleep: standing(); g[6][14] = "S"; g[6][17] = "S"; g[7][14] = "K"; g[7][17] = "K"
        case .splits:
            blit(&g, Array(body.prefix(21)), 8, 4); blit(&g, legsSplits, 0, 24); g[14][14] = "K"; g[14][17] = "K"
        case .epicSplit:
            blit(&g, truckL, 0, 24); blit(&g, truckR, 24, 24)
            blit(&g, Array(body.prefix(21)), 8, 0); blit(&g, legsSplits, 0, 20)
        case .kick: blit(&g, body, 8, 0); blit(&g, legsKick, 8, 24)
        case .treeKickA: blit(&g, tree, 26, 13); blit(&g, body, 8, 0); blit(&g, legsKick, 8, 24)
        case .treeKickB: blit(&g, tree, 26, 13); blit(&g, body, 8, 0); blit(&g, legsApart, 8, 24)
        case .danceA:
            blit(&g, head, 7, 0); blit(&g, torso, 7, 14); blit(&g, armOutL, 5, 15); blit(&g, armOutR, 19, 15); blit(&g, legsApart, 7, 24)
        case .danceB:
            blit(&g, head, 9, 0); blit(&g, torso, 9, 14); blit(&g, armOutL, 7, 14); blit(&g, armOutR, 21, 14); blit(&g, legsTogether, 9, 24)
        case .guardA:
            blit(&g, head, 8, 0); blit(&g, torso, 8, 14); blit(&g, fist, 9, 14); blit(&g, fist, 20, 14)
            g[15][12] = "S"; g[15][19] = "S"; blit(&g, legsApart, 8, 24)
        case .guardB:
            blit(&g, head, 8, 1); blit(&g, torso, 8, 15); blit(&g, fist, 9, 15); blit(&g, fist, 20, 15)
            g[16][12] = "S"; g[16][19] = "S"; blit(&g, Array(legsApart.dropFirst()), 8, 25)
        case .double:
            standing(0, 0)
            blit(&g, body, 16, 0, map: ["O": "C", "o": "c"]); blit(&g, legsTogether, 16, 24) // Alex, the twin in orange
        case .flashKickA: blit(&g, body, 8, -6); blit(&g, legsKick, 8, 18)
        case .flashKickB: blit(&g, body, 8, -3); blit(&g, legsKick, 8, 21)
        case .salute:
            blit(&g, head, 8, 0); blit(&g, torso, 8, 14); blit(&g, armDownL, 8, 14); blit(&g, armSalute, 19, 6); blit(&g, legsTogether, 8, 24)
        case .mulletA: standing(); blit(&g, hairLong, 23, 3)
        case .mulletB: standing(); blit(&g, hairShort, 23, 3)
        }
        cache[f] = g
        return g
    }

    // MARK: - Menu bar + images

    static let menubarGlyph = [
        "..XXXXXXXX..", ".XXXXXXXXXX.", "XXXXXXXXXXXX", "XXX......XXX", "XXX......XXX", "XXX.X..X.XXX", "XXX......XXX",
        "XXX......XXX", ".XX.XXXX.XX.", ".XXX....XXX.", "..XXX..XXX..", "....XXXX....", "..XXXXXXXX..", "XXXXXXXXXXXX",
    ]

    static func menubarImage() -> NSImage {
        let s: CGFloat = 1.5
        let image = NSImage(size: NSSize(width: 12 * s, height: 14 * s), flipped: true) { _ in
            NSColor.black.setFill()
            for (r, row) in menubarGlyph.enumerated() { for (c, ch) in row.enumerated() where ch == "X" {
                CGRect(x: CGFloat(c) * s, y: CGFloat(r) * s, width: s, height: s).fill()
            } }
            return true
        }
        image.isTemplate = true
        return image
    }

    static func image(_ f: Frame = .idle, scale: CGFloat = 3, palette pal: [Character: NSColor] = palette) -> NSImage {
        let g = frame(f)
        return NSImage(size: NSSize(width: CGFloat(W) * scale, height: CGFloat(H) * scale), flipped: true) { _ in
            for r in 0..<H { for c in 0..<W {
                guard let ch = g[r][c], let color = pal[ch] else { continue }
                color.setFill()
                CGRect(x: CGFloat(c) * scale, y: CGFloat(r) * scale, width: scale, height: scale).fill()
            } }
            return true
        }
    }
}

/// A move from one of the films. Random ones play while he walks; Claude can trigger them by name.
enum Stunt: String, CaseIterable, Identifiable {
    case splits, epicSplit, kumite, treeKick, dance, guardUp, doubleImpact, flashKick, salute, mullet
    var id: String { rawValue }

    var title: String {
        switch self {
        case .splits: return "The Splits"
        case .epicSplit: return "The Epic Split"
        case .kumite: return "Kumite Kick"
        case .treeKick: return "Nok Su Kow — tree training"
        case .dance: return "The Bar Dance"
        case .guardUp: return "Guard Up"
        case .doubleImpact: return "Chad & Alex"
        case .flashKick: return "Guile's Flash Kick"
        case .salute: return "GR44 reporting"
        case .mullet: return "The Hair Flick"
        }
    }
    var movie: String {
        switch self {
        case .splits: return "Bloodsport (1988)"
        case .epicSplit: return "Volvo Trucks (2013)"
        case .kumite: return "Bloodsport (1988)"
        case .treeKick: return "Kickboxer (1989)"
        case .dance: return "Kickboxer (1989)"
        case .guardUp: return "Lionheart (1990)"
        case .doubleImpact: return "Double Impact (1991)"
        case .flashKick: return "Street Fighter (1994)"
        case .salute: return "Universal Soldier (1992)"
        case .mullet: return "Hard Target (1993)"
        }
    }
    var frames: [JeanSprite.Frame] {
        switch self {
        case .splits: return [.splits]
        case .epicSplit: return [.epicSplit]
        case .kumite: return [.kick]
        case .treeKick: return [.treeKickB, .treeKickA, .treeKickA]
        case .dance: return [.danceA, .danceB]
        case .guardUp: return [.guardA, .guardB]
        case .doubleImpact: return [.double]
        case .flashKick: return [.flashKickB, .flashKickA, .flashKickA, .flashKickB, .kick]
        case .salute: return [.salute]
        case .mullet: return [.mulletA, .mulletB]
        }
    }
    var fps: Double {
        switch self {
        case .dance: return 3
        case .guardUp: return 4
        case .treeKick: return 4
        case .flashKick: return 6
        case .mullet: return 5
        default: return 1
        }
    }
    var seconds: TimeInterval {
        switch self {
        case .kumite: return 1.2
        case .flashKick: return 2
        case .epicSplit, .doubleImpact: return 4.5
        default: return 3.5
        }
    }
    /// Loud stunts he does on his own; the quiet ones are menu / Claude only.
    static let spontaneous: [Stunt] = [.splits, .epicSplit, .treeKick, .dance, .guardUp, .mullet, .flashKick, .salute, .doubleImpact]
}

/// Renders the macOS app icon: Claude's orange rounded tile, pixel Van Damme in cream.
enum IconRenderer {
    static func render(size: Int) -> NSBitmapImageRep {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                   samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        let ctx = NSGraphicsContext(bitmapImageRep: rep)!
        NSGraphicsContext.current = ctx
        ctx.cgContext.interpolationQuality = .none
        ctx.cgContext.translateBy(x: 0, y: CGFloat(size)); ctx.cgContext.scaleBy(x: 1, y: -1)
        let S = CGFloat(size)
        let inset = S * 0.08
        let tile = CGRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
        let path = NSBezierPath(roundedRect: tile, xRadius: S * 0.2, yRadius: S * 0.2)
        JeanSprite.hex(0xD97757).setFill(); path.fill()
        JeanSprite.hex(0xC46A4A).setStroke(); path.lineWidth = max(1, S / 128); path.stroke()
        let g = JeanSprite.frame(.idle)
        let px = floor(tile.height * 0.74 / 28)
        let ox = tile.midX - 8 * px, oy = tile.midY - 14 * px
        for r in 0..<JeanSprite.H { for c in 8..<24 {
            guard let ch = g[r][c], let color = JeanSprite.iconPalette[ch] else { continue }
            color.setFill()
            CGRect(x: ox + CGFloat(c - 8) * px, y: oy + CGFloat(r) * px, width: px, height: px).fill()
        } }
        NSGraphicsContext.restoreGraphicsState()
        return rep
    }

    static func renderIconset(to dir: String) {
        try? FileManager.default.removeItem(atPath: dir)
        try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let specs: [(String, Int)] = [
            ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
            ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
            ("icon_512x512", 512), ("icon_512x512@2x", 1024),
        ]
        for (name, size) in specs {
            try! render(size: size).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
        print("iconset rendered to \(dir)")
    }

    /// Contact sheet of every frame (for checking the art): JeanClawd --render-frames out.png
    static func renderFrames(to path: String) {
        let frames = JeanSprite.Frame.allCases
        let s: CGFloat = 4, gap: CGFloat = 8
        let cols = 5
        let rows = (frames.count + cols - 1) / cols
        let cell = NSSize(width: CGFloat(JeanSprite.W) * s + gap, height: CGFloat(JeanSprite.H) * s + gap + 14)
        let size = NSSize(width: cell.width * CGFloat(cols), height: cell.height * CGFloat(rows))
        let image = NSImage(size: size, flipped: true) { _ in
            JeanSprite.hex(0x15120F).setFill(); NSRect(origin: .zero, size: size).fill()
            for (i, f) in frames.enumerated() {
                let x = CGFloat(i % cols) * cell.width, y = CGFloat(i / cols) * cell.height
                let g = JeanSprite.frame(f)
                for r in 0..<JeanSprite.H { for c in 0..<JeanSprite.W {
                    guard let ch = g[r][c], let color = JeanSprite.palette[ch] else { continue }
                    color.setFill()
                    CGRect(x: x + gap / 2 + CGFloat(c) * s, y: y + 14 + CGFloat(r) * s, width: s, height: s).fill()
                } }
                (f.rawValue as NSString).draw(at: NSPoint(x: x + gap / 2, y: y), withAttributes: [.foregroundColor: NSColor.white, .font: NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)])
            }
            return true
        }
        let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
        try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
    }
}
