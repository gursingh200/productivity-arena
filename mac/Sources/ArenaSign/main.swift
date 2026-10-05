import CryptoKit
import Foundation

// arena-sign: Ed25519 keys and signatures for Arena update zips.
//   arena-sign keygen <private-key-path>    writes the private key (base64, mode 600), prints the public key
//   arena-sign sign <file>                  signs with $ARENA_UPDATE_SIGNING_KEY (base64), prints the signature
//   arena-sign verify <file> <signature> <public-key>

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("arena-sign: \(message)\n".utf8))
    exit(1)
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "keygen":
    guard args.count == 2, let path = args.last else { fail("usage: arena-sign keygen <private-key-path>") }
    guard !FileManager.default.fileExists(atPath: path) else { fail("\(path) already exists; not overwriting") }
    let key = Curve25519.Signing.PrivateKey()
    guard FileManager.default.createFile(atPath: path, contents: Data(key.rawRepresentation.base64EncodedString().utf8),
                                         attributes: [.posixPermissions: 0o600]) else { fail("cannot write \(path)") }
    print(key.publicKey.rawRepresentation.base64EncodedString())

case "sign":
    guard args.count == 2, let path = args.last else { fail("usage: arena-sign sign <file>") }
    guard let encoded = ProcessInfo.processInfo.environment["ARENA_UPDATE_SIGNING_KEY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !encoded.isEmpty else {
        fail("ARENA_UPDATE_SIGNING_KEY is not set")
    }
    guard let raw = Data(base64Encoded: encoded), let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else {
        fail("ARENA_UPDATE_SIGNING_KEY is not a valid key")
    }
    guard let data = FileManager.default.contents(atPath: path) else { fail("cannot read \(path)") }
    guard let signature = try? key.signature(for: data) else { fail("signing failed") }
    print(signature.base64EncodedString())

case "verify":
    let parts = Array(args)
    guard parts.count == 4 else { fail("usage: arena-sign verify <file> <signature> <public-key>") }
    guard let data = FileManager.default.contents(atPath: parts[1]) else { fail("cannot read \(parts[1])") }
    guard let signature = Data(base64Encoded: parts[2]), let raw = Data(base64Encoded: parts[3]),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { fail("bad signature or key") }
    guard key.isValidSignature(signature, for: data) else { fail("signature does not match") }
    print("ok")

default:
    fail("usage: arena-sign keygen <path> | sign <file> | verify <file> <signature> <public-key>")
}
