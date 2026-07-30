import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/profile-form";

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
    </div>
  );
}
