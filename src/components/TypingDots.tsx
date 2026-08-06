const DOT =
  'h-1.5 w-1.5 rounded-full bg-current animate-[chat-blink_1.2s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60';

export function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1 ${className}`.trim()} aria-hidden="true">
      <span className={DOT} />
      <span className={`${DOT} [animation-delay:0.2s]`} />
      <span className={`${DOT} [animation-delay:0.4s]`} />
    </span>
  );
}
