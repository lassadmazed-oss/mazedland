"use client";

import { useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";

// The address does not change while the form is on screen; nothing to subscribe to.
const subscribe = () => () => {};
const getSnapshot = () => new URLSearchParams(window.location.search).get("next");
const getServerSnapshot = () => null;

/**
 * « Créer un compte » under the login form, « Se connecter » under the signup
 * one: the other form, with the `next` this address carries — someone sent to
 * the login from « Vendre » who signs up instead still lands on the publish
 * page.
 *
 * Read in the browser: /login and /signup are one static page for every
 * address, served from the CDN, so the server never sees the query. Until the
 * page hydrates the link goes to the bare form.
 */
export function AuthSwitchLink({
  to,
  className,
  children,
}: {
  to: "/login" | "/signup";
  className?: string;
  children: React.ReactNode;
}) {
  const next = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <Link href={{ pathname: to, query: next ? { next } : {} }} className={className}>
      {children}
    </Link>
  );
}
