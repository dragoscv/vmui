// vmui Toolkit — a status-bar launcher for the macOS guest.
//
// Builds its entire menu from tools.json at launch, so adding a tool is a
// manifest edit, never a code change.
//
// Deliberately AppKit-only and compiled with the Command Line Tools swiftc:
// this VM has no Xcode and cannot sign in to an Apple ID, and — more to the
// point — no Metal device, so anything GPU-backed (SwiftUI previews, the iOS
// Simulator) is off the table. NSStatusItem works fine without a GPU.

import AppKit
import Foundation

// MARK: - Manifest

struct Tool: Decodable {
    let id: String
    let title: String
    let section: String
    let command: [String]
    var confirm: Bool? = nil
    var notify: Bool? = nil
    var requires: [String]? = nil
    var unavailable: String? = nil
}

struct Manifest: Decodable {
    let version: Int
    let tools: [Tool]
}

// MARK: - Capabilities
//
// Gates for tools that cannot run here. Probed once at launch and cached;
// each probe is cheap but `xcode-select` shells out, so don't repeat it.

struct Capabilities {
    let metal: Bool
    let xcode: Bool

    static func probe() -> Capabilities {
        // A NULL default device is exactly the state this VM is in.
        let hasMetal = MTLCreateSystemDefaultDeviceShim()

        // Xcode proper, not just the Command Line Tools: simctl ships with Xcode.
        let dev = runCapturing("/usr/bin/xcode-select", ["-p"])?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hasXcode = dev.contains(".app/Contents/Developer")

        return Capabilities(metal: hasMetal, xcode: hasXcode)
    }

    func satisfies(_ required: [String]?) -> Bool {
        guard let required else { return true }
        for r in required {
            switch r {
            case "metal": if !metal { return false }
            case "xcode": if !xcode { return false }
            default: return false   // unknown requirement: fail closed
            }
        }
        return true
    }
}

/// Metal is weak-linked so the binary still runs on a guest without the
/// framework; `MTLCreateSystemDefaultDevice` returning nil is the signal.
private func MTLCreateSystemDefaultDeviceShim() -> Bool {
    guard let handle = dlopen(
        "/System/Library/Frameworks/Metal.framework/Metal", RTLD_LAZY
    ) else { return false }
    defer { dlclose(handle) }
    guard let sym = dlsym(handle, "MTLCreateSystemDefaultDevice") else { return false }
    typealias Fn = @convention(c) () -> UnsafeMutableRawPointer?
    let fn = unsafeBitCast(sym, to: Fn.self)
    return fn() != nil
}

// MARK: - Process helpers

@discardableResult
private func runCapturing(_ launchPath: String, _ args: [String]) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: launchPath)
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = Pipe()
    do { try p.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: data, encoding: .utf8)
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var caps = Capabilities(metal: false, xcode: false)
    private var tools: [Tool] = []
    private var running = Set<String>()

    /// Where the installer puts guest-side scripts and the manifest.
    private let toolkitDir: String = {
        if let e = ProcessInfo.processInfo.environment["VMUI_TOOLKIT_DIR"] { return e }
        return NSString(string: "~/Library/Application Support/vmui-toolkit")
            .expandingTildeInPath
    }()

    private var logPath: String { "\(toolkitDir)/toolkit.log" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        caps = Capabilities.probe()
        tools = loadManifest()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            // A template image would need an asset catalog (Xcode); a glyph
            // keeps this a single self-contained binary.
            button.title = "🛠"
            button.toolTip = "vmui Toolkit"
        }
        rebuildMenu()
        log("toolkit started — metal=\(caps.metal) xcode=\(caps.xcode) tools=\(tools.count)")
    }

    // MARK: Manifest loading

    private func loadManifest() -> [Tool] {
        let path = "\(toolkitDir)/tools.json"
        guard let data = FileManager.default.contents(atPath: path) else {
            log("ERROR: no manifest at \(path)")
            return []
        }
        do {
            return try JSONDecoder().decode(Manifest.self, from: data).tools
        } catch {
            log("ERROR: manifest is not valid JSON: \(error)")
            return []
        }
    }

    // MARK: Menu

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.autoenablesItems = false   // we control enablement ourselves

        if tools.isEmpty {
            let item = NSMenuItem(title: "No tools found — check toolkit.log", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }

        // Preserve manifest order rather than sorting: the author's grouping
        // is meaningful (most-used first).
        var seen: [String] = []
        for tool in tools where !seen.contains(tool.section) { seen.append(tool.section) }

        for (i, section) in seen.enumerated() {
            if i > 0 { menu.addItem(.separator()) }
            let header = NSMenuItem(title: section, action: nil, keyEquivalent: "")
            header.isEnabled = false
            menu.addItem(header)

            for tool in tools where tool.section == section {
                let item = NSMenuItem(
                    title: "   \(tool.title)",
                    action: #selector(runTool(_:)),
                    keyEquivalent: ""
                )
                item.target = self
                item.representedObject = tool.id

                if !caps.satisfies(tool.requires) {
                    item.isEnabled = false
                    item.toolTip = tool.unavailable ?? "Unavailable on this machine."
                } else if running.contains(tool.id) {
                    item.isEnabled = false
                    item.title = "   \(tool.title) — running…"
                } else {
                    item.isEnabled = true
                }
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit vmui Toolkit",
                              action: #selector(NSApplication.terminate(_:)),
                              keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)

        statusItem.menu = menu
    }

    // MARK: Running

    @objc private func runTool(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String,
              let tool = tools.first(where: { $0.id == id }) else { return }
        guard !running.contains(id) else { return }

        if tool.confirm == true, !confirm(tool) { return }

        // Expand $TOOLKIT / $TOOLKIT_LOG here rather than in the manifest so
        // the manifest stays portable across install locations.
        let argv = tool.command.map {
            $0.replacingOccurrences(of: "$TOOLKIT_LOG", with: logPath)
              .replacingOccurrences(of: "$TOOLKIT", with: toolkitDir)
        }
        guard let exe = argv.first else { return }

        running.insert(id)
        rebuildMenu()
        log("run \(id): \(argv.joined(separator: " "))")

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let (status, output) = self.execute(exe, Array(argv.dropFirst()))
            DispatchQueue.main.async {
                self.running.remove(id)
                self.rebuildMenu()
                self.log("done \(id): exit=\(status)")
                if tool.notify == true || status != 0 {
                    self.report(tool: tool, status: status, output: output)
                }
            }
        }
    }

    private func execute(_ exe: String, _ args: [String]) -> (Int32, String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch {
            return (-1, "could not launch \(exe): \(error.localizedDescription)")
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    // MARK: UI

    private func confirm(_ tool: Tool) -> Bool {
        let a = NSAlert()
        a.messageText = tool.title
        a.informativeText = "Run this now?"
        a.alertStyle = .warning
        a.addButton(withTitle: "Run")
        a.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        return a.runModal() == .alertFirstButtonReturn
    }

    private func report(tool: Tool, status: Int32, output: String) {
        let a = NSAlert()
        a.messageText = status == 0 ? "\(tool.title) — done" : "\(tool.title) — failed (exit \(status))"
        a.alertStyle = status == 0 ? .informational : .critical

        // Alerts truncate badly; keep the tail, which holds the useful part.
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        a.informativeText = lines.count > 20
            ? "…\n" + lines.suffix(20).joined(separator: "\n")
            : (trimmed.isEmpty ? "No output." : trimmed)

        a.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // MARK: Logging

    private func log(_ line: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        let entry = "[\(stamp)] \(line)\n"
        let dir = (logPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir,
                                                 withIntermediateDirectories: true)
        if let handle = FileHandle(forWritingAtPath: logPath) {
            handle.seekToEndOfFile()
            handle.write(Data(entry.utf8))
            try? handle.close()
        } else {
            try? entry.write(toFile: logPath, atomically: true, encoding: .utf8)
        }
    }
}

// `.accessory` keeps it out of the Dock and the ⌘-Tab switcher — it is a
// status-bar app, not a windowed one.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
