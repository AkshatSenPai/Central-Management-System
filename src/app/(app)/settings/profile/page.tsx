import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/profile-form";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-[var(--text)]">My profile</h1>
      <p className="mt-1 text-sm text-[var(--text-3)]">{user.email}</p>
      <div className="mt-6">
        <ProfileForm
          defaults={{
            name: user.name,
            title: user.title ?? "",
            phone: user.phone ?? "",
            avatarUrl: user.avatarUrl ?? "",
          }}
        />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-medium text-[var(--text)]">Change password</h2>
        {/* Names the way out for the one case this form cannot serve: you
            need the current password to use it, and someone who has
            forgotten theirs cannot reach this page at all. */}
        <p className="mt-1 text-sm text-[var(--text-3)]">
          You need your current password. If you have forgotten it, ask an admin to reset it.
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
