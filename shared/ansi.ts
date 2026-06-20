const RESET = "\x1b[0m";

export const ansi = {
  reset: RESET,
  title: (text: string) => `\x1b[1;96m${text}${RESET}`,
  label: (text: string) => `\x1b[97m${text}${RESET}`,
  link: (text: string) => `\x1b[94;4m${text}${RESET}`,
  accent: (text: string) => `\x1b[93m${text}${RESET}`,
};
