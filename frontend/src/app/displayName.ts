/** SIMBAD prefixes a name with a catalogue class: "NAME Barnard's Star", "* 61 Cyg". Show the bare name. */
export function displayName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/^(?:NAME\s+|\*\s+)/, '').trim();
}
