CREATE TABLE "charges" (
	"owner_gln" text NOT NULL,
	"charge_code" text NOT NULL,
	"charge_type" text NOT NULL,
	"valid_from" timestamp NOT NULL,
	"valid_to" timestamp,
	"hourly_per_kwh" numeric(14, 6)[] NOT NULL,
	"is_tax" boolean DEFAULT false NOT NULL,
	"note" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_owner_gln_charge_code_valid_from_pk" PRIMARY KEY("owner_gln","charge_code","valid_from"),
	CONSTRAINT "charges_24_hours" CHECK (array_length("charges"."hourly_per_kwh", 1) = 24),
	CONSTRAINT "charges_valid_range" CHECK ("charges"."valid_to" is null or "charges"."valid_to" > "charges"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "co2_intensity" (
	"zone" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"g_per_kwh" numeric(8, 2) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	CONSTRAINT "co2_intensity_zone_time_kind_pk" PRIMARY KEY("zone","time","kind"),
	CONSTRAINT "co2_intensity_kind" CHECK ("co2_intensity"."kind" in ('forecast', 'actual'))
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deliveries_action" CHECK ("deliveries"."action" in ('notify', 'start', 'stop', 'push_plan')),
	CONSTRAINT "deliveries_status" CHECK ("deliveries"."status" in ('pending', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "grid_companies" (
	"gln" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"zone" text NOT NULL,
	"degraded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" "bytea",
	"secret_wrapped_key" "bytea",
	"secret_aad" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_kind" CHECK ("integrations"."kind" in ('webpush', 'webhook', 'evcc', 'ha_mqtt', 'easee')),
	CONSTRAINT "integrations_secret_complete" CHECK (("integrations"."secret_ciphertext" is null) = ("integrations"."secret_wrapped_key" is null))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"energy_kwh" numeric(8, 3) NOT NULL,
	"max_power_kw" numeric(6, 2) NOT NULL,
	"earliest" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"contiguous" boolean DEFAULT false NOT NULL,
	"min_run_slots" integer DEFAULT 1 NOT NULL,
	"objective" text DEFAULT 'balanced' NOT NULL,
	"status" text NOT NULL,
	"workflow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_workflow_id_unique" UNIQUE("workflow_id"),
	CONSTRAINT "jobs_kind" CHECK ("jobs"."kind" in ('ev', 'appliance', 'heat_boost', 'custom')),
	CONSTRAINT "jobs_objective" CHECK ("jobs"."objective" in ('cheapest', 'balanced', 'greenest')),
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" in ('planned', 'running', 'done', 'cancelled', 'failed')),
	CONSTRAINT "jobs_window" CHECK ("jobs"."deadline" > "jobs"."earliest"),
	CONSTRAINT "jobs_positive" CHECK ("jobs"."energy_kwh" > 0 and "jobs"."max_power_kw" > 0)
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"site_id" uuid NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"kwh" numeric(10, 4) NOT NULL,
	CONSTRAINT "meter_readings_site_id_slot_start_pk" PRIMARY KEY("site_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "plan_slots" (
	"plan_id" uuid NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"energy_kwh" numeric(8, 4) NOT NULL,
	"price_per_kwh" numeric(14, 6) NOT NULL,
	"co2_g_per_kwh" numeric(8, 2) NOT NULL,
	"estimated" boolean NOT NULL,
	CONSTRAINT "plan_slots_plan_id_slot_start_pk" PRIMARY KEY("plan_id","slot_start")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"provisional" boolean NOT NULL,
	"cost" numeric(14, 6) NOT NULL,
	"co2_grams" numeric(14, 2) NOT NULL,
	"baseline_now_cost" numeric(14, 6) NOT NULL,
	"baseline_midnight_cost" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_job_version" UNIQUE("job_id","version"),
	CONSTRAINT "plans_reason" CHECK ("plans"."reason" in ('created', 'prices_published', 'co2_updated', 'user_edit'))
);
--> statement-breakpoint
CREATE TABLE "price_zones" (
	"code" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"time_zone" text NOT NULL,
	"full_price" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"zone" text NOT NULL,
	"grid_gln" text,
	"supplier_markup_per_kwh" numeric(14, 6) DEFAULT '0' NOT NULL,
	"co2_price_per_kg" numeric(8, 2) DEFAULT '1' NOT NULL,
	"feed_token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_feed_token_hash_unique" UNIQUE("feed_token_hash")
);
--> statement-breakpoint
CREATE TABLE "spot_prices" (
	"zone" text NOT NULL,
	"slot_start" timestamp with time zone NOT NULL,
	"price_per_kwh" numeric(14, 6) NOT NULL,
	"price_eur_per_kwh" numeric(14, 6) NOT NULL,
	"source" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_prices_zone_slot_start_pk" PRIMARY KEY("zone","slot_start"),
	CONSTRAINT "spot_prices_slot_aligned" CHECK (extract(epoch from "spot_prices"."slot_start")::bigint % 900 = 0)
);
--> statement-breakpoint
CREATE TABLE "tariff_mappings" (
	"gln" text NOT NULL,
	"customer_type" text NOT NULL,
	"charge_code" text NOT NULL,
	CONSTRAINT "tariff_mappings_gln_customer_type_pk" PRIMARY KEY("gln","customer_type")
);
--> statement-breakpoint
CREATE TABLE "vat_rates" (
	"zone" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"basis_points" integer NOT NULL,
	CONSTRAINT "vat_rates_zone_valid_from_pk" PRIMARY KEY("zone","valid_from"),
	CONSTRAINT "vat_rates_range" CHECK ("vat_rates"."basis_points" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "co2_intensity" ADD CONSTRAINT "co2_intensity_zone_price_zones_code_fk" FOREIGN KEY ("zone") REFERENCES "public"."price_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_companies" ADD CONSTRAINT "grid_companies_zone_price_zones_code_fk" FOREIGN KEY ("zone") REFERENCES "public"."price_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_zone_price_zones_code_fk" FOREIGN KEY ("zone") REFERENCES "public"."price_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_grid_gln_grid_companies_gln_fk" FOREIGN KEY ("grid_gln") REFERENCES "public"."grid_companies"("gln") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_prices" ADD CONSTRAINT "spot_prices_zone_price_zones_code_fk" FOREIGN KEY ("zone") REFERENCES "public"."price_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_mappings" ADD CONSTRAINT "tariff_mappings_gln_grid_companies_gln_fk" FOREIGN KEY ("gln") REFERENCES "public"."grid_companies"("gln") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_zone_price_zones_code_fk" FOREIGN KEY ("zone") REFERENCES "public"."price_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_site_status" ON "jobs" USING btree ("site_id","status");