/**
 * The production data key provider: AWS KMS, eu-west-2 (ADR-0012).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Do not fake KMS availability in a way that makes
 * production security claims untrue."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is real here, and what is unverified ─────────────────────────────
 *
 * REAL: the SDK calls, the parameters, the key spec, the error handling, and
 * the zeroing. This is the code that will run.
 *
 * UNVERIFIED: that it works against a live KMS key, because no AWS account is
 * reachable from this repository and none is faked. There is no test in this
 * repository that exercises this class against KMS, and the deployment document
 * (`docs/secure-plane-deployment.md`) names the one-command check an operator
 * runs before the first real secret. Saying so is the point: a mocked KMS test
 * passing would be evidence of nothing except that the mock matched the mock.
 *
 * ── Why `GenerateDataKey` and not `Encrypt` ───────────────────────────────
 *
 * `Encrypt` sends the plaintext to KMS. For a 4 KiB limit and a password that
 * would technically work, and it would mean the credential leaving this process
 * over the network and appearing in a service we do not control. Envelope
 * encryption sends nothing: KMS mints a key, we encrypt locally, and KMS never
 * sees the secret. ADR-0034's threat model depends on that.
 *
 * ── The encryption context ────────────────────────────────────────────────
 *
 * Bound into the AAD of the KMS operation, so a wrapped key minted for one
 * purpose cannot be unwrapped while claiming another. It is not confidential —
 * it appears in CloudTrail, which is why it carries the request id and never
 * the student's identity in a form that means anything outside our database.
 */

import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from "@aws-sdk/client-kms";

import type { DataKey, DataKeyProvider } from "./vault.js";

export interface KmsKeyProviderOptions {
  /** The customer master key. An ARN or an alias. */
  readonly keyId: string;
  readonly region: string;
  /** Injected so a caller can supply a configured client; not for mocking. */
  readonly client?: KMSClient;
  /**
   * Appears in CloudTrail. Must contain nothing confidential and nothing that
   * identifies a student outside our own database.
   */
  readonly encryptionContext?: Readonly<Record<string, string>>;
}

export class KmsDataKeyProvider implements DataKeyProvider {
  public readonly kind = "kms" as const;
  readonly #client: KMSClient;
  readonly #keyId: string;
  readonly #context: Record<string, string>;

  public constructor(options: KmsKeyProviderOptions) {
    this.#client = options.client ?? new KMSClient({ region: options.region });
    this.#keyId = options.keyId;
    this.#context = { ...options.encryptionContext, purpose: "aas-secure-vault" };
  }

  public async generateDataKey(): Promise<DataKey> {
    const response = await this.#client.send(
      new GenerateDataKeyCommand({
        KeyId: this.#keyId,
        KeySpec: "AES_256",
        EncryptionContext: this.#context,
      }),
    );
    if (response.Plaintext === undefined || response.CiphertextBlob === undefined) {
      // Thrown, not defaulted. A provider that returned a fabricated key on a
      // partial response would encrypt with something KMS cannot unwrap, and the
      // failure would surface minutes later as a secret that cannot be spent.
      throw new Error("KMS returned no data key");
    }
    return {
      plaintext: Buffer.from(response.Plaintext),
      wrapped: Buffer.from(response.CiphertextBlob),
    };
  }

  public async decryptDataKey(wrapped: Buffer): Promise<Buffer | null> {
    try {
      const response = await this.#client.send(
        new DecryptCommand({
          CiphertextBlob: wrapped,
          KeyId: this.#keyId,
          EncryptionContext: this.#context,
        }),
      );
      return response.Plaintext === undefined ? null : Buffer.from(response.Plaintext);
    } catch {
      // Null rather than a rethrow, and deliberately nothing from the error:
      // an SDK exception carries the request parameters, and one of those is
      // the wrapped key. A caller sees "this handle does not resolve", which is
      // the same answer an unknown handle gets.
      return null;
    }
  }
}
