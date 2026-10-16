import { z } from "zod";
import type { Settings } from "./model";
export const zLiftSpeedSchema = z.number().finite().min(0.1).max(5).default(5);
export const zLowerSpeedSchema = z.number().finite().min(0.1).max(5).default(3);
export const drawingSchema = z
  .object({
    contactZ: z.number().finite().min(0).max(245),
    lift: z.number().finite().min(0.1).max(30),
    drawSpeed: z.number().finite().min(1).max(40),
    travelSpeed: z.number().finite().min(1).max(80),
    zLiftSpeed: zLiftSpeedSchema,
    zLowerSpeed: zLowerSpeedSchema,
    frame: z.boolean(),
  })
  .refine(
    (s) => s.contactZ + s.lift <= 250,
    "Высота переходов превышает 250 мм",
  );
export const settingsSchema = z.object({
  language: z.enum(["system", "ru", "en"]).default("system"),
  printerName: z.string().trim().min(1).max(64),
  host: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.:[\]-]*$/, "Некорректный адрес"),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().max(4096),
  drawing: drawingSchema,
  strokeWidth: z.number().finite().min(0.01).max(5),
  showTravel: z.boolean(),
});
export const defaults: Settings = {
  language: "system",
  printerName: "K1 SE",
  host: "",
  username: "root",
  password: "",
  drawing: {
    contactZ: 0,
    lift: 2,
    drawSpeed: 10,
    travelSpeed: 30,
    zLiftSpeed: 5,
    zLowerSpeed: 3,
    frame: true,
  },
  strokeWidth: 0.5,
  showTravel: true,
};

export function hasConnectionSettings(
  settings: Pick<Settings, "host" | "username" | "password">,
): boolean {
  return !!(
    settings.host.trim() &&
    settings.username.trim() &&
    settings.password
  );
}
