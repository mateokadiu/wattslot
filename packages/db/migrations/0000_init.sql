CREATE TABLE `charges` (
	`owner_gln` text NOT NULL,
	`charge_code` text NOT NULL,
	`charge_type` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`hourly_micro` text NOT NULL,
	`is_tax` integer DEFAULT false NOT NULL,
	`note` text,
	`ingested_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`owner_gln`, `charge_code`, `valid_from`),
	CONSTRAINT "charges_24_hours" CHECK(json_array_length("charges"."hourly_micro") = 24),
	CONSTRAINT "charges_valid_from_format" CHECK("valid_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'),
	CONSTRAINT "charges_valid_to_format" CHECK("valid_to" is null or "valid_to" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'),
	CONSTRAINT "charges_valid_range" CHECK("charges"."valid_to" is null or "charges"."valid_to" > "charges"."valid_from")
);
--> statement-breakpoint
CREATE TABLE `co2_intensity` (
	`zone` text NOT NULL,
	`time_ms` integer NOT NULL,
	`kind` text NOT NULL,
	`g_per_kwh` real NOT NULL,
	`issued_at_ms` integer NOT NULL,
	PRIMARY KEY(`zone`, `time_ms`, `kind`),
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "co2_intensity_kind" CHECK("co2_intensity"."kind" in ('forecast', 'actual')),
	CONSTRAINT "co2_intensity_aligned" CHECK("co2_intensity"."time_ms" % 300000 = 0)
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliveries_action" CHECK("deliveries"."action" in ('notify', 'start', 'stop', 'push_plan')),
	CONSTRAINT "deliveries_status" CHECK("deliveries"."status" in ('pending', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_idempotency_key_unique` ON `deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `grid_companies` (
	`gln` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`zone` text NOT NULL,
	`metering_points` integer,
	`support` text NOT NULL,
	`support_note` text,
	`degraded_at_ms` integer,
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "grid_companies_support" CHECK("grid_companies"."support" in ('supported', 'unsupported'))
);
--> statement-breakpoint
CREATE TABLE `ingest_state` (
	`task` text PRIMARY KEY NOT NULL,
	`last_success_at_ms` integer,
	`next_attempt_at_ms` integer,
	`last_error` text,
	`updated_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`secret_ciphertext` blob,
	`secret_wrapped_key` blob,
	`secret_aad` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integrations_kind" CHECK("integrations"."kind" in ('webpush', 'webhook', 'evcc', 'ha_feed', 'easee')),
	CONSTRAINT "integrations_secret_complete" CHECK(("integrations"."secret_ciphertext" is null) = ("integrations"."secret_wrapped_key" is null))
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`energy_wh` integer NOT NULL,
	`max_power_w` integer NOT NULL,
	`earliest_ms` integer NOT NULL,
	`deadline_ms` integer NOT NULL,
	`contiguous` integer DEFAULT false NOT NULL,
	`min_run_slots` integer DEFAULT 1 NOT NULL,
	`objective` text DEFAULT 'balanced' NOT NULL,
	`status` text NOT NULL,
	`workflow_id` text NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "jobs_kind" CHECK("jobs"."kind" in ('ev', 'appliance', 'heat_boost', 'custom')),
	CONSTRAINT "jobs_objective" CHECK("jobs"."objective" in ('cheapest', 'balanced', 'greenest')),
	CONSTRAINT "jobs_status" CHECK("jobs"."status" in ('planned', 'running', 'done', 'cancelled', 'failed')),
	CONSTRAINT "jobs_window" CHECK("jobs"."deadline_ms" > "jobs"."earliest_ms"),
	CONSTRAINT "jobs_positive" CHECK("jobs"."energy_wh" > 0 and "jobs"."max_power_w" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_workflow_id_unique` ON `jobs` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `jobs_site_status` ON `jobs` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`site_id` text NOT NULL,
	`slot_start_ms` integer NOT NULL,
	`energy_wh` integer NOT NULL,
	PRIMARY KEY(`site_id`, `slot_start_ms`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_slots` (
	`plan_id` text NOT NULL,
	`slot_start_ms` integer NOT NULL,
	`energy_wh` integer NOT NULL,
	`price_micro` integer NOT NULL,
	`co2_g_per_kwh` real NOT NULL,
	`estimated` integer NOT NULL,
	PRIMARY KEY(`plan_id`, `slot_start_ms`),
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_slots_aligned" CHECK("plan_slots"."slot_start_ms" % 900000 = 0)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`provisional` integer NOT NULL,
	`cost_micro` integer NOT NULL,
	`co2_grams` real NOT NULL,
	`baseline_now_micro` integer NOT NULL,
	`baseline_midnight_micro` integer NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plans_reason" CHECK("plans"."reason" in ('created', 'prices_published', 'co2_updated', 'user_edit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_job_version` ON `plans` (`job_id`,`version`);--> statement-breakpoint
CREATE TABLE `price_zones` (
	`code` text PRIMARY KEY NOT NULL,
	`currency` text NOT NULL,
	`time_zone` text NOT NULL,
	`full_price` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`zone` text NOT NULL,
	`grid_gln` text,
	`supplier_markup_micro` integer DEFAULT 0 NOT NULL,
	`co2_price_micro_per_kg` integer DEFAULT 1000000 NOT NULL,
	`feed_token_hash` blob NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`grid_gln`) REFERENCES `grid_companies`(`gln`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_feed_token_hash_unique` ON `sites` (`feed_token_hash`);--> statement-breakpoint
CREATE TABLE `spot_prices` (
	`zone` text NOT NULL,
	`slot_start_ms` integer NOT NULL,
	`price_micro` integer NOT NULL,
	`price_eur_micro` integer NOT NULL,
	`source` text NOT NULL,
	`ingested_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`zone`, `slot_start_ms`),
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "spot_prices_slot_aligned" CHECK("spot_prices"."slot_start_ms" % 900000 = 0)
);
--> statement-breakpoint
CREATE TABLE `tariff_mappings` (
	`gln` text NOT NULL,
	`customer_type` text NOT NULL,
	`charge_code` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`gln`, `customer_type`, `charge_code`),
	FOREIGN KEY (`gln`) REFERENCES `grid_companies`(`gln`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tariff_mappings_role" CHECK("tariff_mappings"."role" in ('tariff', 'discount'))
);
--> statement-breakpoint
CREATE TABLE `vat_rates` (
	`zone` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`basis_points` integer NOT NULL,
	PRIMARY KEY(`zone`, `valid_from`),
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vat_rates_range" CHECK("vat_rates"."basis_points" between 0 and 10000),
	CONSTRAINT "vat_rates_date_format" CHECK("valid_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
