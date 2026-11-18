# PELoop Apple student companion

This is the first local iPhone + Apple Watch source scaffold for the selected path:

`Apple Watch → paired student iPhone → same local Wi-Fi → Android teacher tablet`

The iPhone parses the teacher's one-use `PELOOP_PAIR_V1` QR, pins the tablet's TLS public-key fingerprint, keeps the ticket/resume token in memory, starts a token-bound watch workout, and sends only heart-rate samples over `/wearable/v1`. A new watch token is generated after every relay reconnect. The app drops samples while disconnected and does not persist a queue. It discovers a changed tablet IP with Bonjour service `_peloop-wearable._tcp.` matching both `sid` and `fp`; if discovery fails, it asks the teacher for a new QR.

The watch uses HealthKit `HKWorkoutSession`/`HKLiveWorkoutBuilder` and WatchConnectivity. It requests heart rate and a workout session, does not request GPS or other health data, does not call `finishWorkout`, and discards the temporary builder on stop. HealthKit intentionally does not reveal whether heart-rate read access was denied, so no incoming sample remains a blank reading. A permission failure does not stop the class. Keep the iPhone app in the foreground during class; iOS may suspend its local socket while backgrounded, in which case the displayed measurement remains blank.

## Local checks and project generation

The platform-neutral QR and relay message code is a Swift Package with focused tests:

```sh
cd native/apple
swift test
```

On macOS with Xcode and XcodeGen installed, generate the iOS/watchOS project and build its schemes:

```sh
cd native/apple
xcodegen generate
xcodebuild -project PELoopAppleStudent.xcodeproj -scheme StudentPhone -destination 'generic/platform=iOS Simulator' build
xcodebuild -project PELoopAppleStudent.xcodeproj -scheme StudentWatchExtension -destination 'generic/platform=watchOS Simulator' build
```

This managed Linux environment has no Swift, Xcode, Apple SDKs, signing identity, or Apple devices. The Swift tests, XcodeGen project, simulator build, HealthKit authorization, WatchConnectivity, local-network permission, Wi-Fi discovery/reconnect, and device behavior remain unverified. Do not describe the Apple app as built or as supporting a verified watch model yet.

The retail catalog records Apple's published A-number families and initial store availability dates; these dates do not establish a Korea-specific first-sale date. Sources: [Apple model identifiers](https://support.apple.com/en-us/108056), [Apple Watch and iPhone compatibility](https://support.apple.com/en-ie/118490), [2023 availability](https://www.apple.com/newsroom/2023/09/iphone-15-lineup-and-new-apple-watch-lineup-arrive-worldwide/), [2024 availability](https://www.apple.com/newsroom/2024/09/get-ready-to-upgrade-to-the-new-iphone-16-apple-watch-and-airpods-lineups/), [2025 availability](https://www.apple.com/ca/newsroom/2025/09/get-ready-to-discover-the-next-generation-of-iphone-apple-watch-and-airpods/), and [2026 availability](https://www.apple.com/newsroom/2026/09/the-latest-iphone-apple-watch-and-airpods-lineups-arrive-in-stores-worldwide/). Apple also lists iPhone SE (2nd generation or later) as compatible with watchOS 27 in its [Ultra 4 announcement](https://www.apple.com/newsroom/2026/09/apple-unveils-apple-watch-ultra-4/). OS requirements depend on the installed watchOS version.

The separate `Watch7,N` runtime entries remain provisional 2023/2024 candidates: their family and date assignments are not verified mappings to the retail A-numbers, and no 2025/2026 runtime identifiers have been added. Candidate OS lower bounds are watchOS 10/iOS 17 and watchOS 11/iOS 18 respectively. The phone accepts samples only after an eligible ready message for the current token; unknown identifiers and insufficient iOS are rejected. The watch separately checks watchOS. These gates do not establish actual device compatibility or hardware testing. The four-year date cutoff is enforced separately by the existing PWA bridge.

The iPhone bundle requires the local-network privacy prompt, Camera permission, Bonjour service declaration, and an Xcode signing profile capable of embedding the watch app. The watch extension requires HealthKit capability. No signing team, certificate, provisioning profile, or distribution setting is stored here.
