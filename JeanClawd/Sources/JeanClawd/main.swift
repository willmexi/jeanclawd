import AppKit

// `JeanClawd --render-icon <iconset dir>` renders the app icon PNGs from the
// sprite and exits (used by scripts/package-app.sh) — one sprite definition,
// no separate icon script to keep in sync.
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--render-icon" {
    IconRenderer.renderIconset(to: CommandLine.arguments[2])
    exit(0)
}
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--render-frames" {
    IconRenderer.renderFrames(to: CommandLine.arguments[2])
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu-bar app, no Dock icon
app.run()
