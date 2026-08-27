-- Fold retired booking_form_sent into awaiting_client_signature.
-- Sending a booking form is the same workflow state as waiting for the client to sign.

update public.deals
set stage = 'awaiting_client_signature'
where stage = 'booking_form_sent';
