CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "account" (
	"account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar,
	"password" varchar,
	"whatsapp_number" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "account_whatsapp_number_unique" UNIQUE("whatsapp_number")
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"budget_id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"category_id" integer,
	"name" varchar,
	"amount" numeric,
	"period" varchar
);
--> statement-breakpoint
CREATE TABLE "category" (
	"category_id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"name" varchar,
	"icon" varchar
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"transaction_id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"wallet_id" integer,
	"category_id" integer,
	"budget_id" integer,
	"type" "transaction_type",
	"amount" numeric,
	"name" varchar,
	"is_ai_generated" boolean DEFAULT false,
	"receipt_image_url" varchar,
	"report_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wallet" (
	"wallet_id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"name" varchar,
	"balance" numeric DEFAULT '0',
	"is_primary" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_wallet_id_wallet_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallet"("wallet_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_budget_id_budget_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("budget_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_account_id_account_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("account_id") ON DELETE no action ON UPDATE no action;
