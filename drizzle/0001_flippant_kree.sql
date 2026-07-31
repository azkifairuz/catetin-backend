ALTER TABLE "transaction" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "receipt_merchant" varchar;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "receipt_line_type" varchar;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "quantity" numeric;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "unit_price" numeric;