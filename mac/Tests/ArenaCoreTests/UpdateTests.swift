import CryptoKit
import Foundation
import Testing
@testable import ArenaCore

@Suite struct UpdateTests {

    let key = Curve25519.Signing.PrivateKey()
    let zip = Data("pretend this is Arena-0.1.1.zip".utf8)

    func manifest(build: Int = 2, zip data: Data? = nil, signedBy signer: Curve25519.Signing.PrivateKey? = nil,
                  minimumSystemVersion: String = "14.0") throws -> ReleaseManifest {
        let bytes = data ?? zip
        let signature = try (signer ?? key).signature(for: bytes)
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        return ReleaseManifest(version: "0.1.\(build - 1)", build: build, zip: "Arena-0.1.\(build - 1).zip",
                               sha256: digest, signature: signature.base64EncodedString(),
                               minimumSystemVersion: minimumSystemVersion)
    }

    let sonoma = OperatingSystemVersion(majorVersion: 14, minorVersion: 5, patchVersion: 0)

    @Test func parsesTheManifestTheReleaseWorkflowWrites() throws {
        let json = #"{"version":"0.1.42","build":42,"zip":"Arena-0.1.42.zip","sha256":"ab","signature":"cd","minimumSystemVersion":"14.0"}"#
        let m = try ReleaseManifest.parse(Data(json.utf8))
        #expect(m.version == "0.1.42" && m.build == 42 && m.zip == "Arena-0.1.42.zip")
    }

    @Test func rejectsManifestsThatCouldEscapeTheReleasePath() {
        for zip in ["../Arena.zip", "a/b.zip", "Arena.tar", "Arena 1.zip"] {
            let json = #"{"version":"0.1.1","build":2,"zip":"\#(zip)","sha256":"x","signature":"y","minimumSystemVersion":"14.0"}"#
            #expect(throws: UpdateError.self) { try ReleaseManifest.parse(Data(json.utf8)) }
        }
        let badVersion = #"{"version":"1/../2","build":2,"zip":"a.zip","sha256":"x","signature":"y","minimumSystemVersion":"14.0"}"#
        #expect(throws: UpdateError.self) { try ReleaseManifest.parse(Data(badVersion.utf8)) }
    }

    @Test func updatesOnlyToAHigherBuildOnASupportedSystem() throws {
        let m = try manifest(build: 5)
        #expect(UpdatePolicy.decide(m, currentBuild: 4, system: sonoma) == .update(m))
        #expect(UpdatePolicy.decide(m, currentBuild: 5, system: sonoma) == .upToDate)
        #expect(UpdatePolicy.decide(m, currentBuild: 9, system: sonoma) == .upToDate)
        let needs15 = try manifest(build: 5, minimumSystemVersion: "15.1")
        #expect(UpdatePolicy.decide(needs15, currentBuild: 4, system: sonoma) == .needsNewerSystem("15.1"))
        let tahoe = OperatingSystemVersion(majorVersion: 26, minorVersion: 0, patchVersion: 0)
        #expect(UpdatePolicy.decide(needs15, currentBuild: 4, system: tahoe) == .update(needs15))
    }

    @Test func acceptsAZipSignedWithTheAppsKey() throws {
        try UpdatePolicy.verify(zip: zip, manifest: try manifest(), publicKey: key.publicKey.rawRepresentation)
    }

    @Test func refusesAZipSignedWithAnotherKey() throws {
        let other = Curve25519.Signing.PrivateKey()
        #expect(throws: UpdateError.badSignature) {
            try UpdatePolicy.verify(zip: zip, manifest: try manifest(signedBy: other), publicKey: key.publicKey.rawRepresentation)
        }
    }

    @Test func refusesATamperedZip() throws {
        let m = try manifest()
        var tampered = zip
        tampered.append(0x41)
        #expect(throws: UpdateError.checksumMismatch) {
            try UpdatePolicy.verify(zip: tampered, manifest: m, publicKey: key.publicKey.rawRepresentation)
        }
        // Even with a matching checksum, the signature must cover the bytes.
        var forged = m
        forged.sha256 = SHA256.hash(data: tampered).map { String(format: "%02x", $0) }.joined()
        #expect(throws: UpdateError.badSignature) {
            try UpdatePolicy.verify(zip: tampered, manifest: forged, publicKey: key.publicKey.rawRepresentation)
        }
    }

    @Test func configIsOffWithoutARepoAndAValidKey() {
        let pub = key.publicKey.rawRepresentation.base64EncodedString()
        #expect(UpdateConfig(info: [:]) == nil)
        #expect(UpdateConfig(info: ["ArenaUpdateRepo": "acme/arena-releases"]) == nil)
        #expect(UpdateConfig(info: ["ArenaUpdateRepo": "acme/arena-releases", "ArenaUpdatePublicKey": "short"]) == nil)
        #expect(UpdateConfig(info: ["ArenaUpdateRepo": "not a repo", "ArenaUpdatePublicKey": pub]) == nil)
        let config = UpdateConfig(info: ["ArenaUpdateRepo": "acme/arena-releases", "ArenaUpdatePublicKey": pub])
        #expect(config?.manifestURL.absoluteString == "https://github.com/acme/arena-releases/releases/latest/download/latest.json")
    }

    @Test func buildsGitHubDownloadURLs() throws {
        let pub = key.publicKey.rawRepresentation.base64EncodedString()
        let config = try #require(UpdateConfig(info: ["ArenaUpdateRepo": "acme/arena-releases", "ArenaUpdatePublicKey": pub]))
        let m = try manifest(build: 43)
        #expect(config.zipURL(for: m).absoluteString == "https://github.com/acme/arena-releases/releases/download/v0.1.42/Arena-0.1.42.zip")
        let local = try #require(UpdateConfig(info: ["ArenaUpdateRepo": "t/r", "ArenaUpdatePublicKey": pub,
                                                     "ArenaUpdateBaseURL": "http://127.0.0.1:8765"]))
        #expect(local.manifestURL.absoluteString == "http://127.0.0.1:8765/t/r/releases/latest/download/latest.json")
    }
}

@Suite struct StorePathTests {
    @Test func defaultBuildKeepsItsFolderAndOtherBuildsGetTheirOwn() {
        #expect(Store.defaultPath(bundleId: "io.clueso.arena").hasSuffix("/Application Support/Arena/arena.db"))
        #expect(Store.defaultPath(bundleId: nil).hasSuffix("/Application Support/Arena/arena.db"))
        #expect(Store.defaultPath(bundleId: "com.acme.arena").hasSuffix("/Application Support/Arena-com.acme.arena/arena.db"))
    }
}
