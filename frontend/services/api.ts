import { Platform } from "react-native";

const localDevelopmentApiUrl =
  Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000";

const DEFAULT_API_URLS = [
  process.env.EXPO_PUBLIC_API_URL?.trim(),
  localDevelopmentApiUrl,
].filter(Boolean) as string[];

const buildApiUrl = (baseUrl: string, endpoint: string) =>
  `${baseUrl.replace(/\/$/, "")}${endpoint}`;

const handleResponse = async (response: Response) => {
  const text = await response.text();

  console.log("API status:", response.status);
  console.log("API content-type:", response.headers.get("content-type"));

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned non-JSON response: ${text.substring(0, 200)}`,
    );
  }

  if (!response.ok) {
    if (
      response.status === 502 &&
      text.includes("ERR_NGROK_8012")
    ) {
      throw new Error(
        "Backend is not reachable through ngrok. Start the backend on localhost:5000 and keep the ngrok tunnel running.",
      );
    }

    throw new Error(data.message || `API Error: ${response.status}`);
  }

  return data;
};

const callApi = async (
  endpoint: string,
  options?: RequestInit,
  attemptUrls: string[] = DEFAULT_API_URLS,
) => {
  const [baseUrl, ...rest] = attemptUrls;

  if (!baseUrl) {
    throw new Error("EXPO_PUBLIC_API_URL is not configured");
  }

  try {
    const response = await fetch(buildApiUrl(baseUrl, endpoint), options);

    if (response.status === 404 && rest.length > 0) {
      return callApi(endpoint, options, rest);
    }

    return handleResponse(response);
  } catch (error) {
    if (rest.length > 0) {
      return callApi(endpoint, options, rest);
    }

    throw error;
  }
};

export const api = {
  get: async (endpoint: string) => {
    return callApi(endpoint);
  },

  post: async (endpoint: string, data: unknown) => {
    return callApi(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  },
};
