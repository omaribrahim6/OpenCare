import { redirect } from "next/navigation";

/** The admin moved to /admin. Old links and bookmarks keep working. */
export default async function OldReviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  redirect(view ? `/admin?view=${encodeURIComponent(view)}` : "/admin");
}
