#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char tag_id[17];
    uint8_t confidence; /* 0-255 */
    uint8_t rssi;
    uint32_t timestamp_ms;
    bool valid;
} rfid_read_t;

/* Produce an observation. Do not write Field OS state here. */
bool rfid_poll(rfid_read_t *out);

#ifdef __cplusplus
}
#endif
