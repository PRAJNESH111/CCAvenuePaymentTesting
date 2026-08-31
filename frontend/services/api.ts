const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("EXPO_PUBLIC_API_URL is not configured");
}

const handleResponse = async (response: Response) => {
  const text = await response.text();

  console.log("API status:", response.status);
  console.log("API content-type:", response.headers.get("content-type"));
  console.log("API response:", text);

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned non-JSON response: ${text.substring(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message || `API Error: ${response.status}`
    );
  }

  return data;
};

export const api = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_URL}${endpoint}`);

    return handleResponse(response);
  },

  post: async (endpoint: string, data: unknown) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    return handleResponse(response);
  },
};