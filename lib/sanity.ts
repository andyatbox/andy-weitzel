import { createClient } from "@sanity/client";
import { createImageUrlBuilder } from "@sanity/image-url";

// Public, read-only client for the box-creative Sanity project. The dataset is
// public, so no token is needed; browser requests work because localhost:3000
// (and the deploy origin) are allow-listed in the project's CORS settings.
export const sanity = createClient({
  projectId: "qdpuwnm5",
  dataset: "production",
  apiVersion: "2024-01-01",
  useCdn: true,
});

const builder = createImageUrlBuilder(sanity);
type ImageSource = Parameters<typeof builder.image>[0];

export function urlFor(source: ImageSource) {
  return builder.image(source);
}
