import SwiftUI

@main
struct DockercdConsoleApp: App {
    @StateObject private var store = ConsoleStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .frame(minWidth: 1_080, minHeight: 700)
                .onChange(of: scenePhase) { _, phase in
                    store.setApplicationActive(phase == .active)
                }
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Add Controller…") {
                    store.showAddConnection = true
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }
    }
}
