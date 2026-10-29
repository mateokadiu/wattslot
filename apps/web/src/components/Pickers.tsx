'use client';

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GridCompany, Zone } from '@/lib/api';
import type { Dictionary, Locale } from '@/lib/i18n';

const trigger =
  'h-11 w-full rounded-lg border-[var(--border)] bg-[var(--card)] px-3.5 text-sm font-normal shadow-none hover:bg-[var(--card)]';

const areaName = (t: Dictionary, code: string) =>
  code === 'DK1' || code === 'DK2' ? t.areas[code] : `${code} · ${t.areas.other}`;

export function AreaPicker({
  t,
  zones,
  value,
  onChange,
}: {
  t: Dictionary;
  zones: Zone[];
  value: string;
  onChange: (zone: string) => void;
}) {
  const full = zones.filter((z) => z.fullPrice);
  const spot = zones.filter((z) => !z.fullPrice);
  return (
    <div>
      <p id="price-area-label" className="label mb-1.5">
        {t.priceArea}
      </p>
      <Select value={zones.length > 0 ? value : undefined} onValueChange={onChange}>
        <SelectTrigger
          aria-labelledby="price-area-label"
          className={`${trigger} data-[size=default]:h-11`}
        >
          <SelectValue placeholder={areaName(t, value)} />
        </SelectTrigger>
        <SelectContent position="popper" className="rounded-lg">
          <SelectGroup>
            <SelectLabel className="label">{t.fullPriceGroup}</SelectLabel>
            {full.map((z) => (
              <SelectItem key={z.code} value={z.code}>
                {areaName(t, z.code)}
              </SelectItem>
            ))}
          </SelectGroup>
          {spot.length > 0 && <SelectSeparator />}
          <SelectGroup>
            <SelectLabel className="label">{t.spotOnlyGroup}</SelectLabel>
            {spot.map((z) => (
              <SelectItem key={z.code} value={z.code}>
                {z.code}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export function GridCompanyPicker({
  t,
  locale,
  companies,
  value,
  disabled,
  onChange,
}: {
  t: Dictionary;
  locale: Locale;
  companies: GridCompany[];
  value: string;
  disabled: boolean;
  onChange: (gln: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = companies.find((g) => g.gln === value);
  const compact = new Intl.NumberFormat(locale === 'da' ? 'da-DK' : 'en-GB', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const groups = [
    { heading: t.fullPriceGroup, items: companies.filter((g) => g.supported) },
    { heading: t.spotOnlyGroup, items: companies.filter((g) => !g.supported) },
  ].filter((group) => group.items.length > 0);

  return (
    <div>
      <p id="grid-company-label" className="label mb-1.5">
        {t.gridCompany}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby="grid-company-label"
            disabled={disabled}
            className={`${trigger} justify-between`}
          >
            <span className={`truncate ${selected ? '' : 'text-[var(--muted)]'}`}>
              {selected?.name ?? t.chooseCompany}
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) rounded-lg p-0">
          <Command>
            <CommandInput placeholder={t.searchCompany} />
            <CommandList className="max-h-80">
              <CommandEmpty>{t.noCompany}</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup
                  key={group.heading}
                  heading={group.heading}
                  className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em]"
                >
                  {group.items.map((g) => (
                    <CommandItem
                      key={g.gln}
                      value={g.name}
                      keywords={[g.gln]}
                      onSelect={() => {
                        onChange(g.gln);
                        setOpen(false);
                      }}
                      className="justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <CheckIcon
                          className={`size-4 shrink-0 ${g.gln === value ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <span className={`truncate ${g.supported ? '' : 'text-[var(--muted)]'}`}>
                          {g.name}
                        </span>
                      </span>
                      {g.meteringPoints !== null && (
                        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">
                          {t.meters(compact.format(g.meteringPoints))}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
