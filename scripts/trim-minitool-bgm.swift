import AVFoundation
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: trim-minitool-bgm.swift input output\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
try? FileManager.default.removeItem(at: outputURL)

let asset = AVURLAsset(url: inputURL)
guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
    fputs("unable to create AVAssetExportSession\n", stderr)
    exit(3)
}

exporter.outputURL = outputURL
exporter.outputFileType = .m4a
exporter.timeRange = CMTimeRange(
    start: .zero,
    duration: CMTime(seconds: 36, preferredTimescale: 600)
)

let semaphore = DispatchSemaphore(value: 0)
exporter.exportAsynchronously {
    semaphore.signal()
}

while semaphore.wait(timeout: .now() + 0.1) == .timedOut {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02))
}

guard exporter.status == .completed else {
    fputs("audio export failed: \(exporter.error?.localizedDescription ?? "unknown error")\n", stderr)
    exit(4)
}
