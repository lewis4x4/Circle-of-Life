import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.NODE_ENV === "production"
    && !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("localhost");

  return {
    rules: {
      userAgent: "*",
      allow: isProduction ? "/" : undefined,
      disallow: isProduction ? ["/admin/", "/caregiver/", "/family/", "/api/"] : "/",
    },
  };
}
