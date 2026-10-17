--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.accounts (id, email, password_hash, status, failed_payment_attempts, created_at, role, plan) VALUES
	(4, 'admin@mediastream.com', '$2b$10$DfNXyYF9RidfUvN32ShCU.Mf4Qmtouh4eeus2Jf0UjxjrOKxdN9Ry', 'ACTIVA', 0, '2026-10-04 04:35:02.946', 'ADMIN', 'PREMIUM'),
	(1, 'laura.martinez@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'MOROSA', 1, '2026-09-23 15:58:21.153', 'USER', 'GRATIS'),
	(2, 'carlos.ruiz@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'MOROSA', 1, '2026-10-03 21:46:06.031', 'USER', 'GRATIS'),
	(3, 'sofia.diaz@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'MOROSA', 1, '2026-10-03 21:48:50.395', 'USER', 'GRATIS'),
	(5, 'ana.lopez@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-04 04:37:17.711', 'USER', 'GRATIS'),
	(6, 'maria.perez@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-04 04:41:57.203', 'USER', 'ESTANDAR'),
	(7, 'andres.gil@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-04 04:49:31.58', 'USER', 'ESTANDAR'),
	(8, 'pedro.rojas@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-04 04:57:11.821', 'USER', 'GRATIS'),
	(9, 'valentina.cruz@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-08 02:19:32.027', 'USER', 'GRATIS'),
	(10, 'diego.mora@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-08 03:11:36.8', 'USER', 'ESTANDAR'),
	(11, 'camila.vega@example.com', '$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe', 'ACTIVA', 0, '2026-10-08 13:42:25.983', 'USER', 'ESTANDAR') ON CONFLICT DO NOTHING;


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.profiles (id, account_id, name, is_kids, created_at) VALUES
	(4, 4, 'Administrador', false, '2026-10-04 04:35:02.946'),
	(7, 6, 'Niños', true, '2026-10-04 04:42:13.286'),
	(9, 7, 'Niños', true, '2026-10-04 04:49:42.021'),
	(13, 10, 'Niños', true, '2026-10-08 03:11:50.117'),
	(15, 11, 'Niños', true, '2026-10-08 13:42:37.979'),
	(1, 1, 'Laura', false, '2026-09-23 15:58:21.164'),
	(2, 2, 'Carlos', false, '2026-10-03 21:46:06.066'),
	(3, 3, 'Sofía', false, '2026-10-03 21:48:50.402'),
	(5, 5, 'Ana', false, '2026-10-04 04:37:17.73'),
	(6, 6, 'María', false, '2026-10-04 04:41:57.391'),
	(8, 7, 'Andrés', false, '2026-10-04 04:49:31.599'),
	(10, 8, 'Pedro', false, '2026-10-04 04:57:11.837'),
	(11, 9, 'Valentina', false, '2026-10-08 02:19:32.062'),
	(12, 10, 'Diego', false, '2026-10-08 03:11:36.852'),
	(14, 11, 'Camila', false, '2026-10-08 13:42:26.061') ON CONFLICT DO NOTHING;


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.accounts_id_seq', 11, true);


--
-- Name: profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.profiles_id_seq', 15, true);


--
-- PostgreSQL database dump complete
--


