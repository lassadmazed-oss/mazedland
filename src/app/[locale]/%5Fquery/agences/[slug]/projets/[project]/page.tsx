import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ProjectView, projectMetadata, readProjectQuery } from "../../../../../agences/[slug]/projets/[project]/ProjectView";

type Params = { slug: string; project: string; locale: string };

/**
 * A project's units still available (?f=available). The proxy sends that
 * address here (src/lib/queryViews.ts), so that the project's page itself can
 * come from the CDN; the reader keeps the public address. Read on each request.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, project, locale } = await params;
  return projectMetadata(slug, project, locale);
}

export default async function ProjectQueryPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ f?: string }> }) {
  const [{ slug, project, locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  return <ProjectView slug={slug} projectSlug={project} locale={locale} view={readProjectQuery(sp)} />;
}
