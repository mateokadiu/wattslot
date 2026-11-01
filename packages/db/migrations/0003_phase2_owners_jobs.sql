-- Phase 2 (PLAN.md §17.7): plans belong to anonymous owners instead of sites. The Phase 0 jobs,
-- plans and plan_slots tables never held a row, so they are rebuilt rather than migrated.
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` blob NOT NULL,
	`feed_token_hash` blob,
	`locale` text NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "owners_locale" CHECK("owners"."locale" in ('en', 'da', 'de', 'nb', 'sv'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_token_hash_unique` ON `owners` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `owners_feed_token_hash_unique` ON `owners` (`feed_token_hash`);--> statement-breakpoint
DROP TABLE `plan_slots`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`task` text NOT NULL,
	`zone` text NOT NULL,
	`grid_gln` text,
	`supplier_markup_micro` integer DEFAULT 0 NOT NULL,
	`co2_price_micro_per_kg` integer DEFAULT 1000000 NOT NULL,
	`energy_wh` integer NOT NULL,
	`max_power_w` integer NOT NULL,
	`earliest_ms` integer NOT NULL,
	`deadline_ms` integer NOT NULL,
	`contiguous` integer NOT NULL,
	`objective` text NOT NULL,
	`status` text NOT NULL,
	`workflow_id` text NOT NULL,
	`replan_requested_ms` integer,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`ended_at_ms` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone`) REFERENCES `price_zones`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`grid_gln`) REFERENCES `grid_companies`(`gln`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "jobs_task" CHECK("jobs"."task" in ('dishwasher', 'washing', 'dryer', 'ev')),
	CONSTRAINT "jobs_objective" CHECK("jobs"."objective" in ('cheapest', 'balanced', 'greenest')),
	CONSTRAINT "jobs_status" CHECK("jobs"."status" in ('planned', 'running', 'done', 'cancelled', 'failed')),
	CONSTRAINT "jobs_window" CHECK("jobs"."deadline_ms" > "jobs"."earliest_ms"),
	CONSTRAINT "jobs_positive" CHECK("jobs"."energy_wh" > 0 and "jobs"."max_power_w" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_workflow_id_unique` ON `jobs` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `jobs_owner_status` ON `jobs` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`version` integer NOT NULL,
	`reason` text NOT NULL,
	`provisional` integer NOT NULL,
	`runs` text NOT NULL,
	`cost_micro` integer NOT NULL,
	`co2_grams` real,
	`baseline_now_micro` integer,
	`baseline_midnight_micro` integer,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plans_reason" CHECK("plans"."reason" in ('created', 'prices_published', 'co2_updated', 'user_edit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_job_version` ON `plans` (`job_id`,`version`);--> statement-breakpoint
CREATE TABLE `plan_slots` (
	`plan_id` text NOT NULL,
	`slot_start_ms` integer NOT NULL,
	`energy_wh` real NOT NULL,
	`price_micro` integer NOT NULL,
	`co2_g_per_kwh` real,
	`estimated` integer NOT NULL,
	PRIMARY KEY(`plan_id`, `slot_start_ms`),
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_slots_aligned" CHECK("plan_slots"."slot_start_ms" % 900000 = 0)
);
