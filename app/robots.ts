import { MetadataRoute } from "next";

// Internal tool only - no public content to crawl or index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/"],
      },
    ],
  };
}
