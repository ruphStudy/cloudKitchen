"use client";

import { ActionForm, Check, Field, inputCls, type FormState } from "@/components/admin/ActionForm";
import type { AdminMenuItem } from "@/lib/admin-data";
import { paiseToRupeesInput } from "@/lib/money";

/** Shrink phone photos before upload (max 1200px JPEG). Falls back to the original file. */
async function resizeImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

interface Props {
  item?: AdminMenuItem;
  save: (prev: FormState, fd: FormData) => Promise<FormState>;
}

export function MenuItemForm({ item, save }: Props) {
  async function action(prev: FormState, fd: FormData): Promise<FormState> {
    const file = fd.get("image");
    if (file instanceof File && file.size > 0) fd.set("image", await resizeImage(file));
    return save(prev, fd);
  }

  return (
    <ActionForm action={action} submitLabel={item ? "Save dish" : "Add dish"} className="space-y-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Name">
        <input name="name" required defaultValue={item?.name} className={inputCls} maxLength={80} />
      </Field>
      <Field label="Short description">
        <textarea
          name="description"
          defaultValue={item?.description}
          maxLength={300}
          rows={2}
          className={`${inputCls} h-auto py-2`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (₹)">
          <input
            name="price_rupees"
            inputMode="decimal"
            required
            defaultValue={item ? paiseToRupeesInput(item.price_paise) : ""}
            placeholder="35"
            className={inputCls}
          />
        </Field>
        <Field label="Stock group">
          <select name="category" defaultValue={item?.category ?? "mutton"} className={inputCls}>
            <option value="mutton">Mutton</option>
            <option value="chicken">Chicken</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sort order">
          <input name="sort_order" type="number" min={0} defaultValue={item?.sort_order ?? 100} className={inputCls} />
        </Field>
        <div className="pt-6">
          <Check name="is_active" label="Show on menu" defaultChecked={item?.is_active ?? true} />
        </div>
      </div>
      <Field label={item?.image_url ? "Replace photo" : "Photo"}>
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-base" />
      </Field>
      {item?.image_url && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- small admin preview */}
          <img src={item.image_url} alt="" className="h-16 w-16 rounded-lg object-cover" />
          <Check name="remove_image" label="Remove photo" />
        </div>
      )}
    </ActionForm>
  );
}
