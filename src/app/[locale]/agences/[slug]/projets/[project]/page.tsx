import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ALL_UNITS, ProjectView, projectMetadata } from "./ProjectView";

/**
 * A promoter's project with all its units. The same for every visitor, so it
 * comes from the CDN, built the first time it is asked for and again at most
 * a minute after a change. « Disponibles » (?f=available) is drawn by the twin
 * under /_query (src/lib/queryViews.ts).
 */
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (headers(), cookies(), searchParams) and silently turns the page
// back into a render on every visit (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";
// Projects published after the build are built on their first visit.
export const dynamicParams = true;

type Params = { slug: string; project: string; locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, project, locale } = await params;
  return projectMetadata(slug, project, locale);
}

export default async function ProjectPage({ params }: { params: Promise<Params> }) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { slug, project, locale } = await params;
  setRequestLocale(locale);
  return <ProjectView slug={slug} projectSlug={project} locale={locale} view={ALL_UNITS} />;
}
