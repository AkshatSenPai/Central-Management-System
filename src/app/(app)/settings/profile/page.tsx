import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { ProfileForm } from "@/components/profile-form";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");

  // Same wrapper as /settings, deliberately. This page was `p-8` full-bleed
  // while its own parent was a centred 720px column, so following the one
  // link on Settings visibly changed the page's width — which is most of why
  // it read as "plain out there" next to the page it came from.
  return (
    <div className="mx-auto max-w-[720px] space-y-5 px-4 pb-10 pt-5 sm:px-6">
      <PageHeader title="My profile" subtitle={user.email} />

      <SectionCard title="Details">
        <ProfileForm
          defaults={{
            name: user.name,
            title: user.title ?? "",
            phone: user.phone ?? "",
            avatarUrl: user.avatarUrl ?? "",
          }}
        />
      </SectionCard>

      <SectionCard title="Change password">
        {/* Names the way out for the one case this form cannot serve: you
            need the current password to use it, and someone who has
            forgotten theirs cannot reach this page at all. */}
        <p className="mb-4 text-sm text-[var(--text-3)]">
          You need your current password. If you have forgotten it, ask an admin to reset it.
        </p>
        <ChangePasswordForm />
      </SectionCard>
    </div>
  );
}
