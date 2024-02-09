import { MatchersV3, PactV3, Verifier } from "@pact-foundation/pact";
import axios from "axios";
import path from "path";
import { describe, expect, it } from "vitest";

const provider = new PactV3({
  provider: "provider-fail",
  consumer: "consumer-fail",
  dir: path.resolve(path.join(process.cwd(), "contracts")),
});

describe("Should test over /", () => {
  it("Consumer", async () => {
    await provider.addInteraction({
      states: [
        {
          description: "Response with 400",
        },
      ],
      uponReceiving: "Should fail without query string",
      withRequest: {
        method: "GET",
        path: "/",
        headers: { "Content-Type": "application/json" },
      },
      willRespondWith: {
        status: 400,
        contentType: "application/json",
        headers: { "Content-Type": "application/json" },
        body: MatchersV3.like({
          errors: MatchersV3.eachLike(MatchersV3.string(), 1),
        }),
      },
    });
    await provider.executeTest(async (mockserver) => {
      try {
        await axios.get(mockserver.url, {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error: any) {
        console.log("RESPONSE", error.response.data);
        expect(error.response.status).toBe(400);
      }
    });
  });

  it("Provider", () => {
    return new Verifier({
      providerBaseUrl: "http://localhost:3000",
      pactUrls: [
        path.resolve(
          process.cwd(),
          "./contracts/consumer-fail-provider-fail.json"
        ),
      ],
    })
      .verifyProvider()
      .then((s) => {
        console.log("Pact Verification Complete!", { s });
      });
  });
});
