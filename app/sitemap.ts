import { MetadataRoute } from "next";

const BASE_URL = "https://intuneget.com";

// Internal tool, fully behind auth - nothing public left to index besides
// the root, which itself just redirects to sign-in.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
  ];
}
