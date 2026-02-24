declare module 'asciichart' {
  export function plot(series: number[] | number[][], config?: {
    height?: number;
    offset?: number;
    padding?: string;
    colors?: number[];
    format?: (x: number) => string;
    min?: number;
    max?: number;
  }): string;
  export const cyan: number;
  export const blue: number;
  export const green: number;
  export const yellow: number;
  export const red: number;
  export const magenta: number;
  export const white: number;
}
