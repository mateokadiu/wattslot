-- Phase 2 notifications (PLAN.md §17.7, P2c): devices that get push messages, and deliveries
-- that can go to a device as well as (later) an integration. deliveries never held a row, so it
-- is rebuilt rather than migrated.
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`endpoint_hash` blob NOT NULL,
	`sealed` blob NOT NULL,
	`wrapped_key` blob NOT NULL,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_ok_ms` integer,
	`failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_hash_unique` ON `push_subscriptions` (`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_owner` ON `push_subscriptions` (`owner_id`);--> statement-breakpoint
DROP TABLE `deliveries`;--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text,
	`subscription_id` text,
	`plan_id` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliveries_action" CHECK("deliveries"."action" in ('notify', 'start', 'stop', 'finish', 'push_plan')),
	CONSTRAINT "deliveries_status" CHECK("deliveries"."status" in ('pending', 'ok', 'failed')),
	CONSTRAINT "deliveries_one_destination" CHECK(("deliveries"."integration_id" is null) != ("deliveries"."subscription_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_idempotency_key_unique` ON `deliveries` (`idempotency_key`);
