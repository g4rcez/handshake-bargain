import { MatchersV3, PactV3, Verifier } from "@pact-foundation/pact";
import axios from "axios";
import path from "path";
import { describe, expect, it } from "vitest";

const provider = new PactV3({
  provider: "provider",
  consumer: "consumer",
  dir: path.resolve(path.join(process.cwd(), "contracts")),
});


describe("Should test over /", () => {
  it("Consumer", async () => {
    await provider.addInteraction({
      states: [
        {
          description: "Response with 200",
          parameters: { type: "query-string" },
        },
      ],
      uponReceiving: "root:true",
      withRequest: {
        method: "GET",
        path: "/",
        query: { type: "query-string" },
        headers: { "Content-Type": "application/json" },
      },
      willRespondWith: {
        status: 200,
        contentType: "application/json",
        headers: { "Content-Type": "application/json" },
        body: MatchersV3.like({ root: true }),
      },
    });
    await provider.executeTest(async (mockserver) => {
      try {
        const response = await axios.get(mockserver.url, {
          headers: { "Content-Type": "application/json" },
          params: { type: "query-string" },
        });
        expect(response.status).toBe(200);
        expect(response.data.root).toBe(true);
      } catch (error) {}
    });
  });

  it("Provider", () => {
    return new Verifier({
      providerBaseUrl: "http://localhost:3000",
      pactUrls: [
        path.resolve(process.cwd(), "./contracts/consumer-provider.json"),
      ],
    })
      .verifyProvider()
      .then((s) => {
        console.log("Pact Verification Complete!", { s });
      });
  });
});
