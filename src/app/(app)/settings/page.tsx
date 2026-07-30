import Link from "next/link";
import { auth } from "@/auth";

export default async function SettingsPage() {
  const session = await auth();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-[var(--text)]">Settings</h1>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <Link href="/settings/profile" className="text-[var(--accent)] hover:underline">
            My profile
          </Link>
        </li>
        {session?.user.role === "ADMIN" && (
          <li>
            <Link href="/settings/members" className="text-[var(--accent)] hover:underline">
              Members
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
