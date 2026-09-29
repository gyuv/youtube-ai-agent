"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActionResult } from "@/lib/action";
import { requireOperator } from "@/lib/auth";
import { ChannelInputSchema, createChannel, disconnectChannel, updateChannel } from "@/services/channels";

export type ChannelFormState = { error: string | null; fieldErrors: Record<string, string> };

export async function saveChannelAction(channelId: string | null, _state: ChannelFormState, formData: FormData): Promise<ChannelFormState> {
  await requireOperator();
  const parsed = ChannelInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(z.flattenError(parsed.error).fieldErrors).map(([field, messages]) => [field, (messages as string[])[0]]),
    );
    return { error: "Some fields need attention.", fieldErrors };
  }

  const result = await toActionResult(() => (channelId ? updateChannel(channelId, parsed.data) : createChannel(parsed.data)));
  if (!result.ok) return { error: result.error, fieldErrors: {} };
  revalidatePath("/", "layout");
  redirect(`/channels/${result.data.id}?saved=1`);
}

export async function disconnectChannelAction(channelId: string): Promise<void> {
  await requireOperator();
  await disconnectChannel(channelId);
  revalidatePath(`/channels/${channelId}`);
  redirect(`/channels/${channelId}?youtube=disconnected`);
}
