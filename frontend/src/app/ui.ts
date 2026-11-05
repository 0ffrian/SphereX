// Shared Tailwind class strings. Border neutral-500 on neutral-950 is about 4:1 (WCAG 1.4.11);
// 44 px targets exceed R9's 24 px minimum and suit phones.
export const buttonClass =
  'inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-md ' +
  'border border-neutral-500 bg-neutral-900 ' +
  'px-3 text-base text-neutral-100 enabled:hover:bg-neutral-800 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed ' +
  'disabled:opacity-40';

export const pressedClass = 'aria-pressed:border-sky-400 aria-pressed:bg-sky-950';
