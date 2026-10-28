import { PlusIcon, XIcon } from "lucide-react";
import { Controller, useFieldArray, useForm, type Control, type FieldValues, type UseFormRegister } from "react-hook-form";
import type { ProfileItem, ProfileKind, Verification } from "@/api/profile";
import { Button, IconButton } from "@/components/ui/button";
import { CheckLine, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { KIND_LABELS, PROFILE_FIELDS, VERIFICATION_LABELS, fromFormValues, toFormValues, type FieldSpec, type ProfileFormValues } from "./fields";

const fieldset = "col-span-full m-0 grid gap-2 rounded-sm border border-line p-3";
const legend = "px-1 text-xs font-medium text-ink-2";

function ClaimsField({ spec, control, register }: { spec: FieldSpec; control: Control<FieldValues>; register: UseFormRegister<FieldValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: spec.name });
  return (
    <fieldset className={fieldset} data-claims={spec.name}>
      <legend className={legend}>{spec.label}</legend>
      <p className="m-0 text-xs text-ink-3">Tick “Verified” only for results you can stand behind (and back up if asked).</p>
      {fields.map((row, index) => (
        <div key={row.id} className="pf-claim grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <Input aria-label="Achievement bullet" placeholder="What you did and the result" {...register(`${spec.name}.${index}.text`)} />
          <CheckLine className="text-xs" data-claim-verified {...register(`${spec.name}.${index}.verified`)}>
            Verified
          </CheckLine>
          <IconButton label="Remove bullet" onClick={() => remove(index)}>
            <XIcon aria-hidden />
          </IconButton>
        </div>
      ))}
      <div>
        <Button variant="quiet" size="sm" data-profile-action="add-claim" onClick={() => append({ claimId: "", text: "", verified: false })}>
          <PlusIcon aria-hidden /> Add bullet
        </Button>
      </div>
    </fieldset>
  );
}

function IdsField({ spec, control, options }: { spec: FieldSpec; control: Control<FieldValues>; options: ProfileItem[] }) {
  const kinds = spec.kinds ?? [];
  return (
    <fieldset className={cn(fieldset, "flex flex-wrap gap-x-4")} data-ids={spec.name}>
      <legend className={cn(legend, "w-full")}>{spec.label}</legend>
      {options.length ? (
        <Controller
          control={control}
          name={spec.name}
          render={({ field }) => {
            const selected = new Set<string>(field.value ?? []);
            return (
              <>
                {options.map((item) => (
                  <label key={item.id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      value={item.id}
                      checked={selected.has(item.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        field.onChange([...next]);
                      }}
                    />
                    {item.label} <small className="text-xs text-ink-3">{KIND_LABELS[item.kind]}</small>
                  </label>
                ))}
              </>
            );
          }}
        />
      ) : (
        <p className="m-0 text-xs text-ink-3">Add {kinds.map((kind) => KIND_LABELS[kind]).join(" or ")} entries first to link them here.</p>
      )}
    </fieldset>
  );
}

function FieldControl({ spec, register, control, options }: { spec: FieldSpec; register: UseFormRegister<FieldValues>; control: Control<FieldValues>; options: ProfileItem[] }) {
  const wide = spec.type === "long" || spec.type === "lines" || spec.type === "list";
  switch (spec.type) {
    case "bool":
      return (
        <CheckLine className="col-span-full" {...register(spec.name)}>
          {spec.label}
        </CheckLine>
      );
    case "claims":
      return <ClaimsField spec={spec} control={control} register={register} />;
    case "ids":
      return <IdsField spec={spec} control={control} options={options} />;
    case "choice":
      return (
        <Field label={spec.label}>
          <Select {...register(spec.name)}>
            {Object.entries(spec.choices ?? {}).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "long":
    case "lines":
      return (
        <Field label={spec.label} help={spec.help} wide>
          <Textarea rows={spec.type === "lines" ? 4 : 3} {...register(spec.name)} />
        </Field>
      );
    default:
      return (
        <Field label={spec.label} help={spec.help} wide={wide}>
          <Input type={spec.type === "url" ? "url" : "text"} placeholder={spec.type === "url" ? "https://" : undefined} {...register(spec.name)} />
        </Field>
      );
  }
}

/**
 * One generated form for personal details or any profile item. The parent saves; this only edits values.
 * Personal details have no verification choice (they are the user's own facts).
 */
export function ProfileForm({
  kind,
  item,
  items,
  onSubmit,
  onCancel,
  onDelete,
}: {
  kind: ProfileKind;
  item: ProfileItem | null;
  items: ProfileItem[];
  onSubmit: (data: Record<string, unknown>, verification: Verification) => Promise<unknown>;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const personal = kind === "personal";
  const defaults = toFormValues(kind, item?.data ?? {}, item?.verification ?? (kind === "skill" ? "verified" : "unverified"));
  const { register, control, handleSubmit, formState } = useForm<FieldValues>({ defaultValues: defaults });
  const linkable = (spec: FieldSpec) => items.filter((other) => spec.kinds?.includes(other.kind) && !other.archived && other.id !== item?.id);
  const title = personal ? "Personal details" : `${item ? "Edit" : "Add"} ${KIND_LABELS[kind]}`;

  return (
    <form
      aria-label={title}
      data-profile-form={kind}
      className={cn("grid gap-3", !personal && "col-span-full rounded-md border border-line bg-surface p-4")}
      onSubmit={handleSubmit((values) => onSubmit(fromFormValues(kind, values as ProfileFormValues), (values as ProfileFormValues).__verification))}
    >
      {personal ? null : <h3 className="m-0 text-md font-semibold">{title}</h3>}
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        {PROFILE_FIELDS[kind].map((spec) => (
          <FieldControl key={spec.name} spec={spec} register={register} control={control} options={linkable(spec)} />
        ))}
        {personal ? null : (
          <Field label="Verification" help="Only verified entries count as facts for AI suggestions">
            <Select {...register("__verification")}>
              {Object.entries(VERIFICATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={formState.isSubmitting}>
          {personal ? "Save personal details" : "Save"}
        </Button>
        {onCancel ? (
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {onDelete ? (
          <Button variant="danger" className="ml-auto" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
