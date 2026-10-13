import Link from "next/link";
import { FadeIn } from "@/components/fade-in";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <FadeIn className="max-w-2xl space-y-6">
        <div className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          Chaptr Tracker
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
          Track your manga, manhwa &amp; manhua in one place
        </h1>
        <p className="text-lg text-muted-foreground sm:text-xl">
          Automatic new chapter release detection, unified library progress, and reading history.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link href="/register">
            <Button size="lg">Get Started</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="lg">Sign In</Button>
          </Link>
        </div>
      </FadeIn>
    </div>
  );
}
