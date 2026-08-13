import { CliError, errorMessage } from "./errors.js";

export interface JsonResponse {
  body: unknown;
  response: Response;
}

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function requestJson(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit = {},
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new CliError(`Could not reach ${new URL(url).origin}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) {
        throw new CliError(`Request failed with HTTP ${response.status}.`);
      }
      throw new CliError("The server returned an invalid JSON response.");
    }
  }

  return { body, response };
}
