/** `true` when `NODE_ENV` is `"production"`. Read once at module load. */
export const IS_PROD = process.env.NODE_ENV === "production";
