import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const fPath = "M132 244V92H296";
const fArmPath = "M132 176H242";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg width="180" height="180" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <g
          fill="none"
          stroke="#7057f5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="60"
        >
          <path d={fPath} />
          <path d={fArmPath} />
          <g transform="rotate(180 256 256)">
            <path d={fPath} />
            <path d={fArmPath} />
          </g>
        </g>
      </svg>
    ),
    size,
  );
}
